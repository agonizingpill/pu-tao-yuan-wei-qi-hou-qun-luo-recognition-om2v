-- 地块试划与接替：一块旧地拆成两块新地，主管签认后一次性切换正式名单。
ALTER TABLE vine_block
    ADD COLUMN IF NOT EXISTS roster_state text NOT NULL DEFAULT 'active'
        CHECK (roster_state IN ('active', 'trial', 'retired')),
    ADD COLUMN IF NOT EXISTS replacement_id integer;

CREATE TABLE IF NOT EXISTS block_replacement (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    old_block_id integer NOT NULL REFERENCES vine_block(id),
    state text NOT NULL CHECK (state IN ('trial', 'signed')),
    reason text NOT NULL,
    actor text NOT NULL REFERENCES account(username),
    signed_by text REFERENCES account(username),
    signed_at timestamptz,
    signoff_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- 同一旧地在签认前只允许一笔试划；签认后保留历史，可再次试划。
CREATE UNIQUE INDEX IF NOT EXISTS one_open_replacement_per_old_block
    ON block_replacement (old_block_id) WHERE state = 'trial';

ALTER TABLE vine_block DROP CONSTRAINT IF EXISTS vine_block_replacement_fk;
ALTER TABLE vine_block
    ADD CONSTRAINT vine_block_replacement_fk
    FOREIGN KEY (replacement_id) REFERENCES block_replacement(id);

ALTER TABLE climate_run
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'official'
        CHECK (kind IN ('official', 'trial')),
    ADD COLUMN IF NOT EXISTS replacement_id integer REFERENCES block_replacement(id);

-- 正式批次与任一笔试划批次可同时开放；同一试划至多一笔开放批次。
DROP INDEX IF EXISTS single_open_climate_run;
CREATE UNIQUE INDEX IF NOT EXISTS single_open_official_climate_run
    ON climate_run ((1)) WHERE status IN ('queued', 'review') AND kind = 'official';
CREATE UNIQUE INDEX IF NOT EXISTS single_open_trial_climate_run
    ON climate_run (replacement_id) WHERE status IN ('queued', 'review') AND kind = 'trial';

-- 试划地块在签认前没有生效标签；把地块在册状态冗余到标签行，唯一生效标签只约束正式在册地块。
ALTER TABLE climate_label
    ADD COLUMN IF NOT EXISTS block_roster_state text NOT NULL DEFAULT 'active'
        CHECK (block_roster_state IN ('active', 'trial', 'retired'));
UPDATE climate_label l SET block_roster_state = b.roster_state
FROM vine_block b WHERE b.id = l.block_id AND l.block_roster_state <> b.roster_state;
DROP INDEX IF EXISTS active_climate_label;
CREATE UNIQUE INDEX IF NOT EXISTS active_climate_label
    ON climate_label (block_id) WHERE state = 'active' AND block_roster_state = 'active';
