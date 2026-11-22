from fastapi import HTTPException

from .db import event
from .domain import ReplacementState, RosterState
from .fieldbook import one

REPLACEMENT_VIEW = '''
    SELECT rp.*, ob.code AS old_code, ob.name AS old_name, ob.sensor AS old_sensor,
           (SELECT count(*) FROM irrigation_round r
             WHERE r.block_id=rp.old_block_id AND r.state IN ('scheduled','needs_replan')) AS open_rounds,
           (SELECT jsonb_build_object('id', cr.id, 'status', cr.status, 'error', cr.error)
              FROM climate_run cr WHERE cr.replacement_id=rp.id AND cr.kind='trial'
              ORDER BY cr.id DESC LIMIT 1) AS last_run,
           (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', b.id, 'code', b.code, 'name', b.name, 'sensor', b.sensor,
                'roster_state', b.roster_state,
                'label', (SELECT l.profile FROM climate_label l
                           WHERE l.block_id=b.id AND l.state='active' LIMIT 1))
              ORDER BY b.code), '[]'::jsonb)
              FROM vine_block b WHERE b.replacement_id=rp.id) AS new_blocks
    FROM block_replacement rp JOIN vine_block ob ON ob.id=rp.old_block_id
'''


def list_replacements(db):
    return db.execute(REPLACEMENT_VIEW + ' ORDER BY rp.id DESC').fetchall()


def get_replacement(db, replacement_id):
    return one(db, REPLACEMENT_VIEW + ' WHERE rp.id=%s', (replacement_id,), '试划单')


def assert_geometry_free(db, data, family_id=None):
    # 试划拆分时，两块新地落在旧地原界内，允许同家族重叠；与其他地块仍不得重叠。
    row = db.execute('''
        SELECT b.code FROM vine_block b
        WHERE int4range(b.east_m,b.east_m+b.width_m) && int4range(%(east_m)s,%(east_m)s+%(width_m)s)
          AND int4range(b.north_m,b.north_m+b.height_m) && int4range(%(north_m)s,%(north_m)s+%(height_m)s)
          AND coalesce(b.replacement_id, -1) <> coalesce(%(family_id)s, -1)
        LIMIT 1
    ''', {**data, 'family_id': family_id}).fetchone()
    if row:
        raise HTTPException(409, f"勘测边界与 {row['code']} 重叠")


def create_replacement(db, data, actor):
    old = one(db, "SELECT * FROM vine_block WHERE id=%s", (data.old_block_id,), '地块')
    if old['roster_state'] != RosterState.ACTIVE:
        raise HTTPException(409, '只有在册正式地块可以发起试划拆分')
    open_rp = db.execute('SELECT 1 FROM block_replacement WHERE old_block_id=%s AND state=%s LIMIT 1',
                         (data.old_block_id, ReplacementState.TRIAL)).fetchone()
    if open_rp:
        raise HTTPException(409, '该地块已有进行中的试划单，签认或结束后才能再次拆分')
    rp_id = db.execute('''
        INSERT INTO block_replacement(old_block_id,state,reason,actor)
        VALUES (%s,%s,%s,%s) RETURNING id
    ''', (data.old_block_id, ReplacementState.TRIAL, data.reason, actor)).fetchone()['id']
    codes, sensors = set(), set()
    for item in data.new_blocks:
        payload = item.model_dump()
        if payload['code'] in codes:
            raise HTTPException(409, '两块新地的地块编号不能相同')
        if payload['sensor'] in sensors:
            raise HTTPException(409, '两块新地必须各自绑定独立探头')
        codes.add(payload['code'])
        sensors.add(payload['sensor'])
        assert_geometry_free(db, payload, rp_id)
        db.execute('''
            INSERT INTO vine_block(code,name,cultivar,area_ha,sensor,east_m,north_m,width_m,height_m,
                                   roster_state,replacement_id)
            VALUES (%(code)s,%(name)s,%(cultivar)s,%(area_ha)s,%(sensor)s,%(east_m)s,%(north_m)s,
                    %(width_m)s,%(height_m)s,%(roster_state)s,%(replacement_id)s)
        ''', {**payload, 'roster_state': RosterState.TRIAL, 'replacement_id': rp_id})
    event(db, actor, 'replacement_opened', rp_id, old_block=old['code'],
          reason=data.reason, new_blocks=sorted(codes))
    return get_replacement(db, rp_id)


def signoff(db, replacement_id, reason, actor):
    rp = get_replacement(db, replacement_id)
    if rp['state'] != ReplacementState.TRIAL:
        raise HTTPException(409, '该试划单已签认，不能重复切换正式名单')
    new_blocks = db.execute('''
        SELECT b.id,b.code FROM vine_block b
        WHERE b.replacement_id=%s AND b.roster_state=%s ORDER BY b.code
    ''', (replacement_id, RosterState.TRIAL)).fetchall()
    if len(new_blocks) != 2:
        raise HTTPException(409, '试划新地缺失，无法签认')
    run = db.execute('''
        SELECT id,status FROM climate_run
        WHERE replacement_id=%s AND kind='trial'
        ORDER BY id DESC LIMIT 1
    ''', (replacement_id,)).fetchone()
    if run is None or run['status'] != 'review':
        raise HTTPException(409, '请先完成两块新地的试划拟合，候选标签待主管确认')
    # 待灌单闸口优先：旧地排灌与签认并发时，未办结一律先拦下。
    open_rounds = db.execute('''
        SELECT code FROM irrigation_round
        WHERE block_id=%s AND state IN ('scheduled','needs_replan') ORDER BY code
    ''', (rp['old_block_id'],)).fetchall()
    if open_rounds:
        raise HTTPException(409, '旧地仍有待灌单未办结：' + '、'.join(r['code'] for r in open_rounds))
    missing = [b['code'] for b in new_blocks if not db.execute('''
        SELECT 1 FROM climate_label WHERE block_id=%s AND run_id=%s AND state='proposed'
    ''', (b['id'], run['id'])).fetchone()]
    if missing:
        raise HTTPException(409, '两块新地都要在试划拟合中判出群落：' + '、'.join(missing))
    # 一次性切换正式拟合名单与排灌口径，其他地块标签不动：只激活两块新地的候选标签。
    db.execute("UPDATE vine_block SET roster_state=%s WHERE id=%s",
               (RosterState.RETIRED, rp['old_block_id']))
    db.execute("UPDATE vine_block SET roster_state=%s WHERE replacement_id=%s",
               (RosterState.ACTIVE, replacement_id))
    db.execute('''
        UPDATE climate_label l SET block_roster_state=b.roster_state
        FROM vine_block b WHERE b.id=l.block_id AND l.run_id=%s AND b.replacement_id=%s
    ''', (run['id'], replacement_id))
    db.execute('''
        UPDATE climate_label l SET state='active'
        FROM vine_block b WHERE l.run_id=%s AND l.state='proposed' AND b.id=l.block_id
          AND b.replacement_id=%s
    ''', (run['id'], replacement_id))
    db.execute("UPDATE climate_run SET status='effective' WHERE id=%s", (run['id'],))
    db.execute('''
        UPDATE block_replacement
        SET state=%s,signed_by=%s,signed_at=now(),signoff_reason=%s WHERE id=%s
    ''', (ReplacementState.SIGNED, actor, reason, replacement_id))
    event(db, actor, 'replacement_signed', replacement_id, old_block=rp['old_code'],
          reason=reason, run_id=run['id'], new_blocks=[b['code'] for b in new_blocks])
    return get_replacement(db, replacement_id)
