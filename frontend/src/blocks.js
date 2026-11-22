import {slots, profiles, rosterStates, replacementStates} from './domain.js';
import {safe, num, localTime, notice, tag, title, field, table, select, button, paragraph} from './ui.js';

function rosterTag(state) {
  const cls = state === 'active' ? 'neutral' : state === 'trial' ? 'warning' : 'retired';
  return `<span class="tag ${cls}">${rosterStates[state] || state}</span>`;
}

function replacementCard(rp, canWrite, supervisor) {
  const blocks = rp.new_blocks.map(b => `<li>${safe(b.code)} ${safe(b.name)} · 探头 ${safe(b.sensor)}
      ${rosterTag(b.roster_state)} ${b.label ? tag(b.label) : '<span class="tag neutral">待拟合</span>'}</li>`).join('');
  const reviewRun = rp.last_run && rp.last_run.status === 'review';
  return `<article class="replacement-card ${rp.state === 'signed' ? 'signed' : ''}">
    <div class="section-label"><h3>试划单 #${rp.id} · ${safe(rp.old_code)} 拆分为两块</h3>
      <span class="tag ${rp.state === 'trial' ? 'warning' : 'neutral'}">${replacementStates[rp.state]}</span></div>
    <p class="muted">${safe(rp.reason)}</p>
    <ul class="trial-blocks">${blocks}</ul>
    <p class="muted">旧地 ${safe(rp.old_code)} 试划期间照常排灌；待灌单未办结：<b>${rp.open_rounds}</b> 笔。</p>
    ${rp.last_run ? `<p class="muted">最近试划批次 #${rp.last_run.id}：${safe(rp.last_run.status)}
      ${rp.last_run.error ? `· ${safe(rp.last_run.error)}` : ''}</p>` : ''}
    ${canWrite && rp.state === 'trial' ? `<details class="form-fold"><summary>发起试划拟合（两块新地替下旧地）</summary>
      <form data-action="trial-run" data-id="${rp.id}">
        ${field('window_end','窗口截止日','type="date" value="2026-11-20"')}
        ${button('冻结试划采样并识别')}
      </form></details>` : ''}
    ${supervisor && rp.state === 'trial' ? `<form data-action="signoff" data-id="${rp.id}">
      ${paragraph('reason','签认理由','两块新地均判出群落且旧地待灌单办结后，一次性切换正式名单。')}
      ${button('主管签认并一次性切换')}
      ${reviewRun ? '' : notice('试划拟合未进入待确认，或仍有待灌单未办结，签认会被拦下。')}
    </form>` : ''}
    ${rp.state === 'signed' ? `<p class="muted">${localTime(rp.signed_at)} 由 ${safe(rp.signed_by)} 签认：${safe(rp.signoff_reason || '')}</p>` : ''}
  </article>`;
}

function ledgerPanel(ledger) {
  if (!ledger) return '';
  const roundRows = ledger.rounds.map(r => `<tr><td>${safe(r.code)}</td><td>${localTime(r.starts_at)}</td>
    <td>${r.minutes} 分钟</td><td>${tag(r.profile)} v${r.revision}</td><td>${r.state === 'completed' ? '已完灌' : r.state}</td>
    <td>${r.harvest_count ? '有采收观察' : '—'}</td></tr>`).join('');
  const harvestRows = ledger.harvests.map(h => `<tr><td>${safe(h.round_code)}</td><td>${localTime(h.observed_at)}</td>
    <td>${num(h.brix)} °Bx</td><td>${h.berry_count} 粒</td><td>${safe(h.note)}</td></tr>`).join('');
  return `<section class="bottom"><h2>地块台账（完灌与采收按原地块查询）</h2>
    ${ledger.rounds.length ? table(['轮次','排定开始','时长','标签依据','状态','采收'], roundRows) : notice('该地块暂无排灌轮次。')}
    <h3>采收观察</h3>
    ${ledger.harvests.length ? table(['轮次','观察时间','糖度','果粒数','备注'], harvestRows) : notice('该地块暂无采收观察。')}
  </section>`;
}

export function blockPage(blocks, block, history, ledger, replacements, canWrite, supervisor) {
  const geometry = blocks.map(b => `<button type="button" class="parcel ${safe(b.profile || 'neutral')} ${b.roster_state !== 'active' ? b.roster_state : ''} ${b.id === block?.id ? 'chosen' : ''}"
    data-block="${b.id}" aria-pressed="${b.id === block?.id}" style="--e:${b.east_m/10}%;--n:${b.north_m/10}%;--w:${b.width_m/10}%;--h:${b.height_m/10}%">${safe(b.code)}<small>${safe(b.name)}</small></button>`).join('');
  const rows = blocks.map(b => `<tr><td><button class="text-button" data-block="${b.id}">${safe(b.code)}</button></td>
    <td>${safe(b.name)}</td><td>${safe(b.sensor)}</td><td>${rosterTag(b.roster_state)}</td><td>${tag(b.profile)}</td></tr>`);
  const activeBlocks = blocks.filter(b => b.roster_state === 'active');
  return `${title('地块与采样', '北坡可拆分为两块试划新地：旧地照常排灌，新地各自探头留样，签认后一次性接替。')}
    <div class="spread">
      <section><div class="section-label"><h2>坡畦边界图</h2><span>局部坐标 · 1,000 × 1,000 m</span></div>
        <div class="survey-map"><span class="north">↑ N</span><div class="site">${geometry}</div><span class="scale">虚线/描边区分试划与已接替地块</span></div>
        <div class="legend">${Object.keys(profiles).map(tag).join('')}
          <span class="tag warning">试划新地</span><span class="tag retired">已接替旧地</span></div>
        ${rows.length ? table(['地块','地形名','绑定探头','在册状态','已生效标签'], rows) : notice('还没有地块。登记边界与探头后开始记采。')}
      </section>
      <section class="ledger">${block ? `
        <span class="ref">${safe(block.code)} / ${safe(block.sensor)}</span>
        <h2>${safe(block.name)} ${rosterTag(block.roster_state)}</h2>
        <p class="muted">${safe(block.cultivar)} · ${num(block.area_ha,2)} ha ${block.revision ? `· 标签 v${block.revision}` : ''}</p>
        ${canWrite ? `<details class="form-fold" id="capture"><summary>录入或补采读数</summary><form data-action="sample">
          <input type="hidden" name="block_id" value="${block.id}"><div class="fields">
          ${field('sensor','探头编号',`value="${safe(block.sensor)}" readonly`)}${field('observed_day','采样日期','type="date" value="2026-11-20"')}
          ${select('slot','采样班次',Object.entries(slots),'night')}${field('source','原始文件或巡检单','placeholder="wx-recheck-1121.csv" maxlength="90"')}
          ${field('temp_c','温度 °C','type="number" min="-30" max="60" step="0.1"')}${field('rh_pct','相对湿度 %','type="number" min="0" max="100" step="0.1"')}</div>${button('归档读数')}
        </form></details>` : ''}
        <h3>近期气象采样</h3>
        ${history.length ? table(['日期','班次','气温','湿度'], history.slice(0,12).map(r =>
          `<tr title="${safe(r.source)}"><td>${safe(r.observed_day.slice(5))}</td><td>${slots[r.slot]}</td><td>${num(r.temp_c)} °</td><td>${num(r.rh_pct,0)}%</td></tr>`)) : notice('这个探头还没有采样记录。')}` : notice('从边界图选择地块以查看采样。')}
      </section>
    </div>
    ${replacements?.length ? `<section class="bottom"><h2>试划与接替</h2>
      <div class="replacement-list">${replacements.map(rp => replacementCard(rp, canWrite, supervisor)).join('')}</div></section>` : ''}
    ${canWrite ? `<details class="form-fold bottom"><summary>办理试划：把一块在册地块拆成两块新地</summary><form data-action="replacement"><div class="fields wide">
      ${select('old_block_id','被接替的旧地', activeBlocks.map(b => [b.id, `${b.code} ${b.name}`]))}
      </div><div class="fields wide">
      ${paragraph('reason','试划事由','例如：北坡旧藤按坡向拆为东西两台，试划期间各自留样。')}
      </div>
      ${[0, 1].map(i => `<fieldset class="trial-fieldset"><legend>新地 ${i + 1}</legend><div class="fields wide">
        ${field(`code_${i}`,'地块编号',`placeholder="V-${i + 7}"`)}${field(`name_${i}`,'地形名')}${field(`cultivar_${i}`,'品种')}
        ${field(`area_ha_${i}`,'面积 ha','type="number" min="0.01" max="500" step="0.01"')}${field(`sensor_${i}`,'探头编号',`placeholder="WX-${307 + i}"`)}
        ${field(`east_m_${i}`,'西缘东距 m','type="number" min="0" max="999"')}${field(`north_m_${i}`,'南缘北距 m','type="number" min="0" max="999"')}
        ${field(`width_m_${i}`,'东西跨度 m','type="number" min="1" max="500"')}${field(`height_m_${i}`,'南北跨度 m','type="number" min="1" max="500"')}
      </div></fieldset>`).join('')}
      ${button('开立试划单并登记两块新地')}
    </form></details>` : ''}
    ${block ? ledgerPanel(ledger) : ''}`;
}
