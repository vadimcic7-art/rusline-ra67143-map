(() => {
  "use strict";
  const data = window.RUSLINE_MAP_DATA;
  const routes = data.routes;
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const state = { limit: 5, sort: "rank", search: "", selected: "PES" };
  const routeList = document.getElementById("route-list");
  const detail = document.getElementById("route-detail");
  const number = new Intl.NumberFormat("ru-RU");
  const mapReady = typeof window.L !== "undefined";
  let map, layerGroup, activeLine, planeMarker, animationFrame, animationStart;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  }
  function fmt(value, suffix = "") { return value == null || value === "" ? "—" : number.format(value) + suffix; }
  function hours(minutes) { return minutes == null ? "—" : `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2,"0")} мин`; }
  function airborneMinutes(planningMinutes) { return planningMinutes == null ? null : Math.max(0, planningMinutes - 25); }
  function compact(iso) { return `${iso.slice(8,10)}.${iso.slice(5,7)} ${iso.slice(11,16)}`; }
  function visibleRoutes() {
    const q = state.search.trim().toLocaleLowerCase("ru");
    const base = routes.filter(r => (q ? true : r.rank <= state.limit) && (!q || `${r.city} ${r.iata} ${r.region}`.toLocaleLowerCase("ru").includes(q)));
    const compare = {
      rank: (a,b) => a.rank-b.rank,
      opportunity: (a,b) => b.opportunity-a.opportunity || a.rank-b.rank,
      fit: (a,b) => b.aircraftFit-a.aircraftFit || a.rank-b.rank,
      moscow: (a,b) => a.moscowWeekOld-b.moscowWeekOld || a.rank-b.rank,
      rotation: (a,b) => a.estimatedRotationMin-b.estimatedRotationMin || a.rank-b.rank,
    }[state.sort];
    return base.sort(compare);
  }
  function routeByCode(code) { return routes.find(r => r.iata === code); }
  function status(r) {
    if (r.primaryScope === "carrier_program_partial_week") return {label:"Частичная первичная проверка", className:"partial"};
    if (r.primaryScope === "not_rechecked_primary") return {label:"Первично не перепроверено", className:"unchecked"};
    return {label:"Первичная программа проверена", className:""};
  }
  function renderList(rows) {
    routeList.innerHTML = rows.length ? rows.map(r => `<button type="button" class="route-item ${r.iata === state.selected ? "is-selected" : ""}" data-code="${esc(r.iata)}" aria-pressed="${r.iata === state.selected}"><span class="route-rank">${String(r.rank).padStart(2,"0")}</span><span><span class="route-name">${esc(r.city)}</span><span class="route-sub">${esc(r.iata)} · ${r.primaryScope === "not_rechecked_primary" ? "ожидает проверки" : r.primaryScope === "carrier_program_partial_week" ? "проверено частично" : "перепроверено"}</span><span class="route-time">≈ ${hours(airborneMinutes(r.estimatedOutMin))} из VKO</span></span><span><span class="route-score">${fmt(r.combined)}</span><span class="route-score-label">старый балл</span></span></button>`).join("") : `<p class="empty-list">Ничего не найдено. Попробуйте другой город или код.</p>`;
    document.getElementById("visible-count").textContent = `Показано ${rows.length} из 20`;
  }
  function metric(value, label, note = "", red = false) { return `<div class="metric"><span class="metric-value${red ? " red" : ""}">${esc(value)}</span><span class="metric-label">${esc(label)}</span>${note ? `<span class="metric-note">${esc(note)}</span>` : ""}</div>`; }
  function pair(label, value) { return `<div class="small-data"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function renderDetail(r) {
    const s = status(r);
    const evidence = r.primaryScope === "not_rechecked_primary" ? "Первичной перепроверки программы нет" : r.primaryScope === "carrier_program_partial_week" ? `${r.primaryObservedCount} вылетов за проверенные даты 16–21.11` : `${fmt(r.primaryWeek)} вылетов/нед в проверенной программе`;
    const sourceLink = r.primarySource?.startsWith("https://") ? `<a class="evidence-link" href="${esc(r.primarySource)}" target="_blank" rel="noopener noreferrer">Открыть первичный источник ↗</a>` : "";
    detail.innerHTML = `
      <div class="detail-top"><span class="detail-kicker">КАНДИДАТ № ${String(r.rank).padStart(2,"0")} / VKO → ${esc(r.iata)}</span><div class="detail-title"><h3>${esc(r.city)}</h3><span class="iata-pill">${esc(r.iata)}</span></div><div class="detail-subtitle">${esc(r.airport)} · ${esc(r.region)}</div><span class="status-pill ${s.className}">${s.label}</span></div>
      <div class="detail-core"><div class="metric-grid">
        ${metric(fmt(r.opportunity),"Opportunity Score","старый балл · 07.10")}
        ${metric(fmt(r.aircraftFit),"Aircraft Fit Score","старый балл · 07.10")}
        ${metric(fmt(r.moscowWeekOld),"Москва / нед","старый срез · все аэропорты")}
        ${metric(fmt(r.vkoWeekOld),"Внуково / нед","старый срез")}
        ${metric(hours(airborneMinutes(r.estimatedOutMin)),"в воздухе из VKO","оценка · без 25 мин наземного этапа")}
        ${metric(hours(airborneMinutes(r.estimatedBackMin)),"в воздухе в VKO","оценка · без 25 мин наземного этапа")}
        ${metric(hours(r.estimatedRotationMin),"оборот VKO–X–VKO","старая оценка")}
        ${metric(`${r.timeOnlyWindowFits}/5`,"окон подходят по времени","OPS не проверено",true)}
      </div></div>
      <div class="detail-section"><h4>Рейсы из Москвы по дням</h4><div class="weekly">${days.map((day,i) => `<div class="day ${r.moscowDailyOld[i] === 0 ? "zero" : ""}"><span class="day-label">${day}</span><span class="day-number">${fmt(r.moscowDailyOld[i])}</span></div>`).join("")}</div><p class="weekly-note">Исторический недельный срез 07.10.2026 для 16–22.11.2026; полнота и изменения требуют проверки.</p></div>
      <div class="detail-section"><h4>Перепроверка 19.10</h4><strong class="evidence-count">${esc(evidence)}</strong><p>${esc(r.primaryNote || "Частота по официальному расписанию для этой недели ещё не перепроверена.")}</p>${sourceLink}</div>
      <div class="detail-section"><h4>Допустимый вылет из VKO · МСК</h4><div class="fit-rows">${r.windowFit.map((w,i)=>`<div class="fit-row"><b>${days[i]}</b><span>${compact(w.earliestDeparture)}–${compact(w.latestDeparture)}</span><strong>${fmt(w.departureRangeMin)} мин</strong></div>`).join("")}</div><p class="weekly-note">Диапазоны рассчитаны по старой оценке оборота и буферам 60/120 минут. Не подтверждают режим аэропорта, слоты и экипаж.</p></div>
      <div class="detail-section"><h4>Что показывает модель</h4><p>${esc(r.oldWhy || "Кандидат старого исследования; причина выбора требует дополнительной рыночной оценки.")}</p>${pair("Баллы старого рейтинга",fmt(r.combined))}${pair("Самый узкий диапазон вылета",`${fmt(r.narrowestDepartureRangeMin)} мин`)}</div>
      <button class="detail-more" type="button" aria-expanded="false" aria-controls="detail-expanded">Все исходные показатели и риски ↓</button>
      <div class="detail-expanded" id="detail-expanded" hidden>
        ${pair("Расстояние от VKO · старый расчёт",`${fmt(r.oldDistanceKm)} км`)}
        ${pair("Плечо туда для расчёта оборота",hours(r.estimatedOutMin))}
        ${pair("Плечо обратно для расчёта оборота",hours(r.estimatedBackMin))}
        ${pair("Стоянка в пункте · оценка",hours(r.estimatedTurnMin))}
        ${pair("Население города",fmt(r.cityPopulation))}
        ${pair("Население региона",fmt(r.regionalPopulation))}
        ${pair("Пассажиры аэропорта",r.airportPax == null ? "—" : `${fmt(r.airportPax)} · ${r.airportPaxYear || "год неизвестен"}`)}
        ${pair("Поезд из Москвы · старый срез",r.railHours == null ? "—" : `${String(Math.round(r.railHours*10)/10).replace(".",",")} ч`)}
        ${pair("Конкуренты · старый срез",r.oldAirlines || "—")}
        ${pair("Аэропорты Москвы · старый срез",r.oldMoscowAirports || "—")}
        ${pair("Дни / время · старый срез",r.oldDays || "—")}
        <p class="expanded-risk"><b>Ограничение источников:</b> ${esc(r.oldConfidence || r.oldScheduleStatus || "полнота не подтверждена")}</p>
        <p class="expanded-risk"><b>Риск:</b> ${esc(r.oldRisk || "Требуется проверка спроса, режима аэропорта, экипажа, ТО и расходов.")}</p>
      </div>`;
    const more = detail.querySelector(".detail-more");
    more.addEventListener("click", () => { const expanded = detail.querySelector("#detail-expanded"); expanded.hidden = !expanded.hidden; more.setAttribute("aria-expanded", String(!expanded.hidden)); more.textContent = expanded.hidden ? "Все исходные показатели и риски ↓" : "Свернуть показатели ↑"; });
  }
  function airplaneSvg() {
    return `<svg class="plane-glyph" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M24 3c2 0 3 3 3 7v10l15 9v4l-15-4v9l5 4v3l-8-2-8 2v-3l5-4v-9L6 33v-4l15-9V10c0-4 1-7 3-7Z" fill="#f7f8f7" stroke="#a70f29" stroke-width="2"/><path d="M24 7v30" stroke="#c81936" stroke-width="2.5"/><path d="M12 29l12-6 12 6" stroke="#c49a54" stroke-width="1.5" fill="none"/><path d="M20 41h8" stroke="#c81936" stroke-width="2"/></svg>`;
  }
  function initializeMap() {
    if (!mapReady) { document.getElementById("map-fallback").hidden = false; return; }
    map = L.map("map", {zoomControl:false, minZoom:3, maxZoom:9, preferCanvas:true, worldCopyJump:false});
    L.control.zoom({position:"bottomright"}).addTo(map);
    fitAll();
    L.geoJSON(window.RUSLINE_BASEMAP, {style: {color:"#bfcbc9",weight:1,fillColor:"#fcfcfa",fillOpacity:1},interactive:false}).addTo(map);
    for (let lat=40;lat<=70;lat+=10) L.polyline([[lat,20],[lat,100]],{color:"#cad6d9",weight:.7,opacity:.48,interactive:false}).addTo(map);
    for (let lon=30;lon<=90;lon+=10) L.polyline([[37,lon],[77,lon]],{color:"#cad6d9",weight:.7,opacity:.48,interactive:false}).addTo(map);
    map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a>');
    layerGroup = L.layerGroup().addTo(map);
    map.on("zoomend moveend", orientPlane);
  }
  function pinIcon(r, selected) {
    return L.divIcon({className:"", html:`<div class="airport-pin ${r.rank <= 5 ? "top" : ""} ${selected ? "selected" : ""}"></div>`, iconSize:[selected ? 21 : 15,selected ? 21 : 15], iconAnchor:[selected ? 10.5 : 7.5,selected ? 10.5 : 7.5]});
  }
  function renderMap(rows, focusSelected = false) {
    if (!map) return;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    layerGroup.clearLayers();
    activeLine = null; planeMarker = null;
    const chosen = routeByCode(state.selected);
    for (const r of rows) {
      const selected = r.iata === state.selected;
      L.polyline([data.base.coords,r.coords],{color:selected?"#c91737":"#9ba5af",weight:selected?3:1.3,opacity:selected?.88:.42,dashArray:selected?null:"4 6",interactive:false}).addTo(layerGroup);
      const marker = L.marker(r.coords,{icon:pinIcon(r,selected),zIndexOffset:selected?1000:0}).addTo(layerGroup);
      marker.bindTooltip(`${r.city} · ${r.iata} · ≈ ${hours(airborneMinutes(r.estimatedOutMin))} в воздухе из VKO`,{direction:"top",offset:[0,-7]});
      marker.on("click",() => selectRoute(r.iata,true));
      if (selected) activeLine = [data.base.coords,r.coords];
    }
    L.marker(data.base.coords,{icon:L.divIcon({className:"",html:'<div class="vko-pin">VKO</div>',iconSize:[37,37],iconAnchor:[18.5,18.5]}),zIndexOffset:2000}).addTo(layerGroup).bindTooltip("Внуково · база RA-67143",{direction:"top"});
    if (activeLine && chosen) {
      planeMarker = L.marker(data.base.coords,{icon:L.divIcon({className:"",html:airplaneSvg(),iconSize:[38,38],iconAnchor:[19,19]}),interactive:false,zIndexOffset:1500}).addTo(layerGroup);
      animationStart = performance.now();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) planeMarker.setLatLng([(data.base.coords[0]+chosen.coords[0])/2,(data.base.coords[1]+chosen.coords[1])/2]);
      else animationFrame = requestAnimationFrame(animatePlane);
      if (focusSelected) map.fitBounds(activeLine,{padding:[75,75],maxZoom:6,animate:true});
    }
  }
  function orientPlane() {
    if (!map || !planeMarker || !activeLine) return;
    const a=map.latLngToContainerPoint(activeLine[0]), b=map.latLngToContainerPoint(activeLine[1]);
    const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+90;
    const glyph=planeMarker.getElement()?.querySelector(".plane-glyph");
    if (glyph) glyph.style.transform=`rotate(${angle}deg)`;
  }
  function animatePlane(now) {
    if (!planeMarker || !activeLine) return;
    const phase=((now-animationStart)/14000)%1;
    const outward=phase<.5;
    const t=outward?phase*2:(1-phase)*2;
    const ease=t*t*(3-2*t);
    const a=activeLine[0],b=activeLine[1];
    planeMarker.setLatLng([a[0]+(b[0]-a[0])*ease,a[1]+(b[1]-a[1])*ease]);
    orientPlane();
    const glyph=planeMarker.getElement()?.querySelector(".plane-glyph");
    if (glyph && !outward) glyph.style.transform += " rotate(180deg)";
    animationFrame=requestAnimationFrame(animatePlane);
  }
  function fitAll() {
    if (!map) return;
    const points=[data.base.coords,...visibleRoutes().map(r=>r.coords)];
    map.fitBounds(points,{padding:[45,45],maxZoom:6,animate:true});
  }
  function render(focusSelected=false) {
    const rows=visibleRoutes();
    if (rows.length && !rows.some(r=>r.iata===state.selected)) state.selected=rows[0].iata;
    renderList(rows);
    if (rows.length) renderDetail(routeByCode(state.selected));
    else detail.innerHTML='<div class="detail-top"><h3>Нет маршрутов</h3><p>Измените поиск.</p></div>';
    renderMap(rows,focusSelected);
  }
  function selectRoute(code, focus) {
    if (!visibleRoutes().some(r=>r.iata===code)) {state.limit=20;state.search="";document.getElementById("route-search").value="";updateChips();}
    state.selected=code;render(focus);
  }
  function updateChips() {document.querySelectorAll(".filter-chip").forEach(b=>b.classList.toggle("is-active",Number(b.dataset.limit)===state.limit));}
  document.getElementById("windows").innerHTML=data.windowsMsk.map(w=>`<span class="window-chip">${esc(w.day)} ${esc(w.from)}–${esc(w.to)}</span>`).join("");
  document.querySelectorAll(".filter-chip").forEach(button=>button.addEventListener("click",()=>{state.limit=Number(button.dataset.limit);updateChips();render();fitAll();}));
  document.getElementById("route-search").addEventListener("input",e=>{state.search=e.target.value;render();fitAll();});
  document.getElementById("route-sort").addEventListener("change",e=>{state.sort=e.target.value;render();});
  document.getElementById("fit-map").addEventListener("click",fitAll);
  routeList.addEventListener("click",e=>{const button=e.target.closest("[data-code]");if(button)selectRoute(button.dataset.code,true);});
  try { initializeMap(); }
  catch (error) {
    console.error("Не удалось инициализировать карту", error);
    map = null;
    const fallback = document.getElementById("map-fallback");
    fallback.textContent = `Карта недоступна: ${error.message}. Список и показатели направлений остаются доступны.`;
    fallback.hidden = false;
  }
  render();
})();
