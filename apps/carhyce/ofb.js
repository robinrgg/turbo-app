/* ============================================================
   Transfert vers l'interface nationale CARHYCE (OFB)
   ------------------------------------------------------------
   1. OFB.payload(op)  : convertit l'opération aux codes de saisie OFB.
   2. OFB.script(op)   : génère un script autonome (données incluses) à
      coller dans la console du navigateur sur carhyce.eaufrance.fr.
      Le script ajoute un panneau qui remplit la granulométrie (onglet
      « Description de l'opération ») ou crée les transects, leurs berges
      et leurs points (onglet « Informations sur les transects et les berges »).

   Conventions retenues :
   - profondeur transmise telle que saisie (cm, négative hors d'eau) ;
   - le point 0 de l'appli (haut de berge) n'est pas transmis : le point 1
     de l'appli devient le point 1 OFB ;
   - habitat de berge VA ignoré (absent de la nomenclature OFB) ;
   - seuls les transects retenus (actifs et non « Suppression ») sont transmis.
   ============================================================ */

const OFB = {

  VERSION: 1,

  CODES: {
    rive: { 'Gauche': '1', 'Droite': '2' },
    facies_simplifie: { 'Mouille': '1', 'Plat lentique': '2', 'Plat courant': '3', 'Radier Rapide': '4' },
    epaisseur: { 'Entre 0 et 5 m': '1', 'Entre 5 et 10 m': '2', 'Entre 10 et 25 m': '3', 'Supérieure à 25 m': '4' },
    type_vegetation: { 'Naturelle': '2', 'Exotique': '3', 'Plantée': '4' },
    // Libellés des options OFB (liste construite dynamiquement par la page)
    plus_recouvrante: { 'Aucune': 'Aucune', 'Strate arborée': 'Arborescente', 'Strate arbustive': 'Arbustive' },
    materiaux: { 'Aménagements végétalisés': '1', 'Enrochement': '2', 'Matériaux artificiels': '3', 'Matériaux naturels': '4' },
    habitats_berge_ofb: ['BR', 'CR', 'DL', 'SB', 'VS'],
    substrats_ofb: ['D', 'R', 'B', 'PG', 'PF', 'CG', 'CF', 'GG', 'GF', 'S', 'L', 'TV', 'A', 'V'],
    substrats_add_ofb: ['CC', 'CR', 'DL', 'PD', 'VA', 'VS'],
  },

  // Nombre → chaîne à point décimal ; vide si non renseigné
  num(v) {
    if (v == null || v === '' || isNaN(Number(v))) return '';
    return String(Number(v));
  },

  estRetenu(tr) {
    return !!tr.actif && !((tr.modification && tr.modification.type) === 'Suppression');
  },

  berge(op, tr, rive) {
    const C = this.CODES;
    const r = tr['ripisylve_' + rive] || {};
    const b = tr['berge_' + rive] || {};
    const strates = ['arboree', 'arbustive', 'herbacee'].map(k => {
      const s = r[k] || {};
      const present = !!s.presente;
      return {
        present,
        types: present && C.type_vegetation[s.type] ? [C.type_vegetation[s.type]] : [],
        epaisseur: present ? (C.epaisseur[s.epaisseur] || 'NR') : 'NR',
      };
    });
    return {
      strates,
      absente: !strates.some(s => s.present),
      dominante: C.plus_recouvrante[r.plus_recouvrante] || null,
      materiau: C.materiaux[b.materiaux] || '0',
      // VA volontairement ignoré
      habitats: (b.habitats || []).filter(h => C.habitats_berge_ofb.includes(h)),
    };
  },

  transect(op, tr) {
    const C = this.CODES;
    const points = (tr.points || []).slice(1).map(p => ({
      prof: this.num(p.profondeur_cm),
      substrat: C.substrats_ofb.includes(p.substrat_min) ? p.substrat_min : 'NR',
      add: [...new Set([p.substrat_add_1, p.substrat_add_2].filter(a => C.substrats_add_ofb.includes(a)))],
    }));
    return {
      numero: tr.numero,
      debut: C.rive[tr.rive_depart] || '0',
      lpb: this.num(tr.lpb_m),
      lm: this.num(tr.lm_m),
      hpb: this.num(tr.hpb_m),
      facies_simplifie: C.facies_simplifie[tr.facies_simplifie] || '0',
      facies_affine: tr.facies_affine || '',
      remarques: tr.remarques || '',
      berges: { g: this.berge(op, tr, 'rg'), d: this.berge(op, tr, 'rd') },
      points,
    };
  },

  payload(op) {
    const g = (op.granulometrie && op.granulometrie.mesures_mm) || [];
    return {
      source: 'turbo-app/carhyce',
      version: this.VERSION,
      station: { code: op.station.code || '', libelle: op.station.libelle || '', date: op.station.date || '' },
      granulometrie: Array.from({ length: 100 }, (_, i) => this.num(g[i])),
      transects: (op.transects || []).filter(tr => this.estRetenu(tr)).map(tr => this.transect(op, tr)),
    };
  },

  script(op) {
    return `/* CARHYCE turbo-app → OFB : ${(op.station.libelle || '').replace(/\*\//g, '')} */\n`
      + `(${injecteurOFB.toString()})(${JSON.stringify(this.payload(op))});\n`;
  },

  async copier(op) {
    const txt = this.script(op);
    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      // Repli : sélection d'une zone de texte temporaire
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('Copie impossible');
    }
    return txt;
  },
};

/* ============================================================
   Injecteur exécuté sur la page OFB (fonction autonome, sérialisée
   par OFB.script : aucune référence extérieure autorisée ici).
   ============================================================ */
function injecteurOFB(DATA) {
  'use strict';
  const $ = window.jQuery;
  const PANEL_ID = 'turbo-ofb-panel';
  const old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  // ---------- Outils ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  const q = (sel, root = document) => root.querySelector(sel);
  const byName = (name, root = document) => root.querySelector(`[name="${name.replace(/"/g, '\\"')}"]`);
  const visible = el => !!el && el.offsetParent !== null;
  let stop = false;
  const alertes = [];

  function log(msg, niveau = 'info') {
    const box = document.getElementById(PANEL_ID + '-log');
    const line = document.createElement('div');
    line.textContent = msg;
    if (niveau === 'warn') line.style.color = '#b26a00';
    if (niveau === 'err') { line.style.color = '#c62828'; line.style.fontWeight = '700'; }
    if (niveau === 'ok') line.style.color = '#2e7d32';
    if (box) { box.appendChild(line); box.scrollTop = box.scrollHeight; }
    (niveau === 'err' ? console.error : niveau === 'warn' ? console.warn : console.log)('[turbo-ofb] ' + msg);
  }

  function setVal(el, v) {
    if (!el) throw new Error('Champ introuvable');
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Coche/décoche par un vrai clic pour déclencher les scripts de la page
  function setCheck(el, voulu) {
    if (!el) throw new Error('Case introuvable');
    if (el.checked !== !!voulu) el.click();
  }

  function selectParTexte(sel, texte) {
    const cible = norm(texte);
    const opt = [...sel.options].find(o => norm(o.textContent) === cible)
      || [...sel.options].find(o => norm(o.textContent).startsWith(cible));
    if (!opt) return false;
    setVal(sel, opt.value);
    return true;
  }

  // Attend la fin des requêtes AJAX jQuery (stables pendant 400 ms)
  async function attendreAjax(timeout = 30000) {
    const t0 = Date.now();
    let calme = 0;
    await sleep(150);
    while (Date.now() - t0 < timeout) {
      if (visible(document.getElementById('dialogKo')) || visible(document.getElementById('dialogKoGlobal'))) {
        throw new Error('Le site a renvoyé une erreur de traitement');
      }
      if (!$ || $.active === 0) { calme += 100; if (calme >= 400) return; } else calme = 0;
      await sleep(100);
    }
    throw new Error('Délai dépassé en attente du serveur');
  }

  function fermerDialogues() {
    if (!$) return;
    ['#dialogOk', '#dialog'].forEach(s => {
      try { if ($(s).is(':visible')) $(s).dialog('close'); } catch { /* sans effet */ }
    });
  }

  function verifierAlertes(etape) {
    if (alertes.length) {
      const m = alertes.splice(0).join(' | ');
      throw new Error(`Message du site pendant « ${etape} » : ${m}`);
    }
  }

  function arret() { if (stop) throw new Error('Arrêt demandé'); }

  // Interception des boîtes de dialogue natives de la page
  const alertOrig = window.alert, confirmOrig = window.confirm;
  function intercepter() {
    window.alert = m => { alertes.push(String(m)); log('Alerte du site : ' + m, 'warn'); };
    window.confirm = m => { log('Confirmation acceptée : ' + m, 'warn'); return true; };
  }
  function restaurer() { window.alert = alertOrig; window.confirm = confirmOrig; }

  // ---------- Granulométrie ----------
  function remplirGranulo() {
    const titre = document.evaluate("//*[contains(normalize-space(text()),'Granulométrie (mm)')]",
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!titre) throw new Error('Ouvrir l\'onglet « Description de l\'opération » (bloc Granulométrie introuvable)');
    const champs = [...document.querySelectorAll('input')]
      .filter(i => !i.type || i.type === 'text' || i.type === 'number')
      .filter(i => titre.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
    const parNumero = {};
    for (const inp of champs) {
      const cellule = inp.closest('td');
      const prec = cellule ? cellule.previousElementSibling : inp.previousElementSibling;
      const txt = (prec && prec.textContent || '').trim();
      if (/^\d{1,3}$/.test(txt)) {
        const n = parseInt(txt, 10);
        if (n >= 1 && n <= 100 && !parNumero[n]) parNumero[n] = inp;
      }
    }
    const nb = Object.keys(parNumero).length;
    if (nb !== 100) throw new Error(`${nb} champs de granulométrie identifiés sur 100`);
    let n = 0;
    for (let k = 1; k <= 100; k++) {
      setVal(parNumero[k], DATA.granulometrie[k - 1]);
      if (DATA.granulometrie[k - 1] !== '') n++;
    }
    log(`Granulométrie : ${n} valeurs saisies. Vérifier puis cliquer sur « Enregistrer les informations de l'opération ».`, 'ok');
  }

  // ---------- Transects ----------
  const transectsExistants = () => [...document.querySelectorAll('#transectList span')]
    .map(s => (s.textContent.trim().match(/^T(\d+)$/) || [])[1]).filter(Boolean).map(Number);

  const ongletTransect = () => { const a = q('#ongletTransect a'); if (a) a.click(); };
  const ongletBerge = () => { const a = q('#ongletBerge a'); if (a) a.click(); };

  async function enregistrer(etape) {
    ongletTransect();
    const btn = q('input[type="button"][value="Enregistrer le transect et ses berges"]');
    if (!btn) throw new Error('Bouton « Enregistrer le transect et ses berges » introuvable');
    btn.click();
    await attendreAjax();
    verifierAlertes(etape);
    fermerDialogues();
  }

  async function remplirFaciesAffine(libelle) {
    if (!libelle) return;
    const sel = q('#faciesAffine');
    if (!sel) return;
    for (let i = 0; i < 30; i++) {
      if (selectParTexte(sel, libelle)) return;
      await sleep(100);
    }
    log(`Faciès affiné « ${libelle} » absent de la liste OFB : laissé non renseigné`, 'warn');
  }

  async function remplirBerge(cote, b) {
    const S = cote === 'g' ? 'Gauche' : 'Droite', p = cote === 'g' ? 'bg' : 'bd';
    // Strates : présence, type de végétation, épaisseur
    b.strates.forEach((s, k) => {
      setCheck(q(`#${p}_strate_checkbox_${k}`), s.present);
      if (!s.present) return;
      for (let j = 0; j < 4; j++) {
        const cb = byName(`strates${'Berge' + S}[${k}].typeVegetationStrates[${j}].nomencTypeVegetation.tveCode`);
        if (cb) setCheck(cb, s.types.includes(cb.value));
      }
      const ep = q(`#updateTransect_strates${'Berge' + S}_${k}__nomencEpaisseurVegetation_eveCode`);
      if (ep) setVal(ep, s.epaisseur);
    });
    setCheck(q(`#strateAbsente${'Berge' + S}`), b.absente);
    await sleep(200);   // reconstruction éventuelle de la liste « strate la plus recouvrante »
    if (b.dominante) {
      const dom = q(`#strateDominante${'Berge' + S}`);
      if (dom && !selectParTexte(dom, b.dominante)) {
        log(`Berge ${S.toLowerCase()} : strate la plus recouvrante « ${b.dominante} » indisponible`, 'warn');
      }
    }
    setVal(q(`#updateTransect_materiau${'Berge' + S}`), b.materiau);
    for (let i = 0; i < 5; i++) {
      const cb = byName(`habitatCaracteristique${'Berge' + S}[${i}].habitatCaracteristique.hcaCode`);
      if (cb) setCheck(cb, b.habitats.includes(cb.value));
    }
  }

  function lignesPoints() {
    return document.querySelectorAll('.pointTable input[name$=".numPoint"]').length;
  }

  async function transect(t) {
    log(`— T${t.numero} : création`);
    const plus = q('#transectList input[value="+"]');
    if (!plus) throw new Error('Bouton « + » des transects introuvable');
    plus.click();
    await attendreAjax();
    verifierAlertes('création du transect');
    fermerDialogues();
    arret();

    // Détail du transect
    ongletTransect();
    setVal(q('#updateTransect_numeroTransect'), String(t.numero));
    setVal(q('#updateTransect_debutTransect'), t.debut);
    setVal(q('#updateTransect_largeurPleinBord'), t.lpb);
    setVal(q('#updateTransect_largeurMouillee'), t.lm);
    setVal(q('#updateTransect_hauteurPleinBord'), t.hpb);
    setVal(q('#faciesSimplifie'), t.facies_simplifie);
    await attendreAjax();
    await remplirFaciesAffine(t.facies_affine);
    setVal(q('#updateTransect_remarquesTransect'), t.remarques);

    // Berges
    ongletBerge();
    await sleep(300);
    await remplirBerge('g', t.berges.g);
    await remplirBerge('d', t.berges.d);

    await enregistrer(`enregistrement du T${t.numero}`);
    if ((q('#updateTransect_numeroTransect') || {}).value !== String(t.numero)) {
      throw new Error(`Après enregistrement, le transect affiché n'est pas le T${t.numero} : arrêt par sécurité`);
    }
    log(`T${t.numero} : détail et berges enregistrés`);
    arret();

    // Points : création des lignes, puis remplissage
    if (!t.points.length) { log(`T${t.numero} : aucun point`, 'warn'); return; }
    ongletTransect();
    let n = lignesPoints();
    if (n > t.points.length) log(`T${t.numero} : ${n} lignes déjà présentes pour ${t.points.length} points`, 'warn');
    while (n < t.points.length) {
      arret();
      const plusPt = q('#pointsTransect input[value="+"]');
      if (!plusPt) throw new Error('Bouton « + » des points introuvable');
      plusPt.click();
      await attendreAjax();
      verifierAlertes('ajout d\'un point');
      const n2 = lignesPoints();
      if (n2 <= n) throw new Error('Le point n\'a pas été ajouté');
      n = n2;
    }
    t.points.forEach((pt, i) => {
      setVal(byName(`listPoint[${i}].numPoint`), String(i + 1));
      setVal(byName(`listPoint[${i}].profPoint`), pt.prof);
      setVal(byName(`listPoint[${i}].substrat.subCode`), pt.substrat);
      for (let j = 0; j < 6; j++) {
        const cb = byName(`listPoint[${i}].pointSubstratAdd[${j}].substratAdditionnel.sadCode`);
        if (cb) setCheck(cb, pt.add.includes(cb.value));
      }
    });
    await enregistrer(`enregistrement des points du T${t.numero}`);
    log(`T${t.numero} : ${t.points.length} points enregistrés`, 'ok');
  }

  async function lancerTransects(numeros) {
    if (!q('#transectList')) throw new Error('Ouvrir l\'onglet « Informations sur les transects et les berges »');
    const liste = DATA.transects.filter(t => numeros.includes(t.numero));
    for (const t of liste) {
      arret();
      if (transectsExistants().includes(t.numero)) { log(`T${t.numero} déjà présent sur l'OFB : ignoré`, 'warn'); continue; }
      await transect(t);
    }
    log(`Terminé : ${liste.length} transect(s) traité(s). Contrôler la synthèse de l'opération.`, 'ok');
  }

  // ---------- Panneau ----------
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:100000;width:380px;max-height:85vh;'
    + 'display:flex;flex-direction:column;gap:6px;background:#fff;border:2px solid #963;border-radius:6px;'
    + 'padding:10px;font:12px/1.4 Arial,sans-serif;color:#222;box-shadow:0 4px 16px rgba(0,0,0,.25)';
  const existants = transectsExistants();
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <strong>Import turbo-app — ${DATA.station.libelle || DATA.station.code || 'opération'}</strong>
      <button data-a="fermer" title="Fermer">✕</button>
    </div>
    <button data-a="granulo">Remplir la granulométrie (${DATA.granulometrie.filter(v => v !== '').length} valeurs)</button>
    <div><strong>Transects</strong> <a href="#" data-a="tous">tous</a> / <a href="#" data-a="aucun">aucun</a></div>
    <div data-z="liste" style="display:flex;flex-wrap:wrap;gap:4px 10px"></div>
    <div style="display:flex;gap:6px">
      <button data-a="transects" style="flex:1">Envoyer les transects cochés</button>
      <button data-a="stop">Arrêter</button>
    </div>
    <div id="${PANEL_ID}-log" style="overflow:auto;min-height:60px;max-height:40vh;background:#f7f4f0;padding:4px;border-radius:4px"></div>`;
  const zone = panel.querySelector('[data-z="liste"]');
  DATA.transects.forEach(t => {
    const lab = document.createElement('label');
    const deja = existants.includes(t.numero);
    lab.innerHTML = `<input type="checkbox" value="${t.numero}" ${deja ? 'disabled' : 'checked'}> T${t.numero}`
      + ` <small>(${t.points.length} pts${deja ? ', déjà saisi' : ''})</small>`;
    zone.appendChild(lab);
  });
  document.body.appendChild(panel);

  let occupe = false;
  async function executer(fn) {
    if (occupe) return;
    occupe = true; stop = false; intercepter();
    try { await fn(); }
    catch (e) { log(e.message, 'err'); }
    finally { restaurer(); occupe = false; }
  }

  panel.addEventListener('click', e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    e.preventDefault();
    const act = a.dataset.a;
    const cases = [...zone.querySelectorAll('input:not(:disabled)')];
    if (act === 'fermer') { stop = true; panel.remove(); }
    else if (act === 'stop') { stop = true; log('Arrêt demandé : interruption à la prochaine étape', 'warn'); }
    else if (act === 'tous') cases.forEach(c => { c.checked = true; });
    else if (act === 'aucun') cases.forEach(c => { c.checked = false; });
    else if (act === 'granulo') executer(async () => remplirGranulo());
    else if (act === 'transects') {
      const nums = cases.filter(c => c.checked).map(c => Number(c.value));
      if (!nums.length) { log('Aucun transect coché', 'warn'); return; }
      executer(() => lancerTransects(nums));
    }
  });

  log(`Données chargées : ${DATA.transects.length} transects, station ${DATA.station.code || '?'}`
    + (existants.length ? `. Déjà présents sur l'OFB : T${existants.join(', T')}` : ''));
}

if (typeof window !== 'undefined') window.OFB = OFB;
