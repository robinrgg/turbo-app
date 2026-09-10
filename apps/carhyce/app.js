/* ============================================================
   CARHYCE Saisie Terrain — Application principale
   ============================================================ */

// Version du code applicatif. À incrémenter en même temps que CACHE_VERSION
// dans sw.js. Affichée à l'accueil pour vérifier la version en cours sur mobile.
const APP_VERSION = 'v19';

// Parseur de nombre acceptant indifféremment point ou virgule comme séparateur
function parseNum(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace(',', '.').trim();
  if (s === '' || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

const App = {

  state: {
    op: null,           // opération en cours
    screen: 'home',     // écran actif
    currentTransect: 0, // index du transect en cours d'édition
  },

  // ----------- Initialisation -----------
  async init() {
    await DB.open();
    this.bindHeader();
    this.bindHome();
    this.bindOperationScreen();
    this.bindExport();
    this.bindBackButton();
    await this.showHome();
    this.registerSW();
    this.showVersion();
  },

  // Affiche la version du code et celle du cache actif du service worker.
  // Si les deux concordent (ex. « v17 · cache v17 »), l'appareil exécute bien
  // la dernière version. Une divergence signale un cache en cours de bascule.
  showVersion() {
    const el = document.getElementById('app-version');
    if (!el) return;
    el.textContent = 'Version ' + APP_VERSION;
    if ('caches' in window) {
      caches.keys().then(keys => {
        const c = keys.find(k => k.startsWith('carhyce-'));
        if (c) {
          const cv = c.replace('carhyce-', '');
          el.textContent = 'Version ' + APP_VERSION + ' · cache ' + cv;
          if (cv !== APP_VERSION) el.style.color = '#b26a00';
        }
      }).catch(() => {});
    }
  },

  // Intercepte le bouton retour du téléphone (Android) ou le geste retour
  // (iOS) pour qu'il déclenche le retour interne de l'app plutôt que de
  // fermer l'application. Mécanisme : on pousse un état dans l'historique
  // au démarrage, et chaque popstate est traité comme un clic sur btn-back
  // sauf si on est déjà à l'accueil (auquel cas l'app peut être fermée).
  //
  // Sur PC (desktop), ce mécanisme n'a pas lieu d'être et peut au contraire
  // perturber la navigation (focus + Entrée, raccourcis clavier, etc.) :
  // on ne l'active donc QUE si on détecte un environnement mobile.
  bindBackButton() {
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i
                       .test(navigator.userAgent);
    if (!isMobile) {
      // Sur PC, on ne touche pas à l'historique du navigateur.
      // Les boutons in-app (header back/home) restent les seuls moyens de
      // navigation, ce qui évite toute interaction parasite.
      return;
    }

    // Marqueur initial dans l'historique
    window.history.replaceState({ carhyce: 'home' }, '');
    window.history.pushState({ carhyce: 'guard' }, '');

    window.addEventListener('popstate', () => {
      const s = this.state.screen;
      if (s === 'home') {
        // À l'accueil : on laisse le retour fermer l'app au prochain appui,
        // mais on remet un garde-fou pour éviter une fermeture accidentelle
        // si l'utilisateur revient
        window.history.pushState({ carhyce: 'guard' }, '');
        return;
      }
      window.history.pushState({ carhyce: 'guard' }, '');
      if (s === 'op') {
        // Sommaire opération : on remonte directement à l'accueil
        this.showHome();
        return;
      }
      // Tous les autres écrans : simuler un retour interne (btn-back)
      const back = document.getElementById('btn-back');
      if (back && !back.hidden) back.click();
    });
  },

  registerSW() {
    if (!('serviceWorker' in navigator)) return;
    let reloading = false;
    // Si le SW qui contrôle la page change (un nouveau SW vient de prendre le relais),
    // on recharge automatiquement pour servir la nouvelle version. Le flag empêche
    // les boucles de reload.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Force la vérification d'une mise à jour à chaque démarrage
      reg.update().catch(() => {});
      // À chaque détection d'un SW en installation, on l'active dès qu'il est prêt
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Demande au nouveau SW de prendre le contrôle immédiatement
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(err => console.warn('SW registration failed:', err));
  },

  // ----------- Routage entre écrans -----------
  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    this.state.screen = name;
    this.updateHeaderButtons();
    window.scrollTo(0, 0);
  },

  // Met à jour visibilité des boutons home / back en fonction du contexte
  updateHeaderButtons() {
    const backBtn = document.getElementById('btn-back');
    const homeBtn = document.getElementById('btn-home');
    const s = this.state.screen;
    if (s === 'home') {
      // Aucun parent
      backBtn.hidden = true;
      homeBtn.hidden = true;
    } else if (s === 'op') {
      // Sommaire opération : pas de retour parent, juste accueil application
      backBtn.hidden = true;
      homeBtn.hidden = false;
      homeBtn.title = 'Retour à l\'accueil CARHYCE';
    } else if (s === 'transect-edit') {
      // Édition transect : retour à la liste, et home
      backBtn.hidden = false;
      backBtn.title = 'Retour à la liste des transects';
      homeBtn.hidden = false;
      homeBtn.title = 'Retour à l\'accueil CARHYCE';
    } else if (s === 'fusion') {
      // Fusion : outil lancé depuis l'accueil, pas de parent "opération"
      backBtn.hidden = true;
      homeBtn.hidden = false;
      homeBtn.title = 'Retour à l\'accueil CARHYCE';
    } else {
      // Station, granulo, pente, colmatage, transects, export
      backBtn.hidden = false;
      backBtn.title = 'Retour au menu de l\'opération';
      homeBtn.hidden = false;
      homeBtn.title = 'Retour à l\'accueil CARHYCE';
    }
  },

  async showHome() {
    this.state.op = null;
    document.getElementById('app-title').textContent = 'CARHYCE';
    const list = document.getElementById('op-list');
    const empty = document.getElementById('op-list-empty');
    const operations = await DB.list();
    list.innerHTML = '';
    if (operations.length === 0) {
      empty.hidden = false;
    } else {
      empty.hidden = true;
      operations.forEach(op => {
        const li = document.createElement('li');
        const meta = document.createElement('div');
        meta.className = 'op-meta';
        const name = document.createElement('span');
        name.className = 'op-name';
        name.textContent = op.station.libelle || op.station.code || '(opération sans nom)';
        const sub = document.createElement('span');
        sub.textContent = [
          op.station.date || '—',
          op.station.cours_eau,
          op.station.campagne,
        ].filter(Boolean).join(' · ');
        meta.appendChild(name);
        meta.appendChild(sub);
        const arrow = document.createElement('span');
        arrow.textContent = '›';
        arrow.style.fontSize = '1.5rem';
        arrow.style.color = 'var(--text-muted)';
        li.appendChild(meta);
        li.appendChild(arrow);
        li.addEventListener('click', () => this.openOperation(op.id));
        list.appendChild(li);
      });
    }
    this.showScreen('home');
  },

  bindHome() {
    document.getElementById('btn-new-op').addEventListener('click', async () => {
      const op = DB.newOperation();
      await DB.put(op);
      await this.openOperation(op.id);
    });
    document.getElementById('btn-import').addEventListener('click', () =>
      document.getElementById('file-import').click()
    );
    const btnFusion = document.getElementById('btn-fusion');
    if (btnFusion) {
      btnFusion.addEventListener('click', () => {
        this.state.fusion = null;   // repart d'un état neuf
        this.renderFusion();
        this.showScreen('fusion');
      });
    }
    document.getElementById('file-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Toujours forcer un nouvel id à l'import pour ne JAMAIS écraser
        // l'opération en cours (même si le JSON importé a un id existant).
        const ancienId = data.id || '(sans id)';
        data.id = 'op_' + Date.now() + '_imp_' +
                   Math.random().toString(36).slice(2, 8);
        // Marquer le libellé pour distinguer la copie importée de l'originale
        if (data.station && data.station.libelle &&
            !data.station.libelle.includes('(importée)')) {
          data.station.libelle = data.station.libelle + ' (importée)';
        }
        await DB.put(data);
        this.toast('Opération importée (nouvelle entrée créée)');
        await this.showHome();
      } catch (err) {
        alert('Fichier JSON invalide : ' + err.message);
      }
      e.target.value = '';
    });
  },

  bindHeader() {
    // Bouton "back" : remonte au parent contextuel
    document.getElementById('btn-back').addEventListener('click', () => {
      const s = this.state.screen;
      if (s === 'transect-edit') {
        this.openTransects();
      } else if (['station','granulo','pente','colmatage','transects','export'].includes(s)) {
        this.openOperationScreen();
      } else {
        this.showHome();
      }
    });
    // Bouton "home" : retour direct à l'accueil de l'application
    document.getElementById('btn-home').addEventListener('click', () => {
      this.showHome();
    });
  },

  // ----------- Écran opération (sommaire) -----------
  async openOperation(id) {
    const op = await DB.get(id);
    if (!op) {
      alert('Opération introuvable');
      this.showHome();
      return;
    }
    this.state.op = op;
    this.openOperationScreen();
  },

  openOperationScreen() {
    const op = this.state.op;
    document.getElementById('app-title').textContent = op.station.libelle || 'Opération';
    document.getElementById('op-title').textContent = op.station.libelle || '(opération sans nom)';
    document.getElementById('op-subtitle').textContent = [
      op.station.code,
      op.station.cours_eau,
      op.station.date,
      op.station.campagne
    ].filter(Boolean).join(' · ');
    this.updateProgress();
    this.showScreen('op');
  },

  bindOperationScreen() {
    document.querySelectorAll('#screen-op [data-go]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-go');
        switch (target) {
          case 'station':   this.renderStation();   this.showScreen('station');   break;
          case 'granulo':   this.renderGranulo();   this.showScreen('granulo');   break;
          case 'pente':     this.renderPente();     this.showScreen('pente');     break;
          case 'colmatage': this.renderColmatage(); this.showScreen('colmatage'); break;
          case 'transects': this.openTransects();   break;
          case 'export':    this.renderExport();    this.showScreen('export');    break;
        }
      });
    });
    document.getElementById('btn-delete-op').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette opération ? Cette action est irréversible.')) return;
      await DB.delete(this.state.op.id);
      this.toast('Opération supprimée');
      await this.showHome();
    });
  },

  updateProgress() {
    const op = this.state.op;
    const set = (id, txt, done) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      el.classList.toggle('done', done);
    };
    // Station
    const st = op.station;
    // La date est pré-remplie automatiquement à la création : on ne la compte
    // pas comme un champ « renseigné » par l'opérateur.
    const stFilled = [st.code, st.cours_eau, st.lpb_ev_mesures[0], st.debit_m3s].filter(v => v !== null && v !== '').length;
    set('prog-station', stFilled >= 4 ? '✓ saisie' : (stFilled === 0 ? 'À saisir' : `${stFilled} champs renseignés`), stFilled >= 4);
    // Granulo
    const gNb = op.granulometrie.mesures_mm.filter(x => x != null && x !== '').length;
    set('prog-granulo', gNb === 0 ? 'À saisir' : `${gNb}/100 mesures`, gNb >= 100);
    // Pente
    const pNb = op.pente.troncons.length;
    set('prog-pente', pNb === 0 ? 'À saisir' : `${pNb} tronçon${pNb>1?'s':''}`, pNb >= 1);
    // Colmatage
    if (!op.colmatage.actif) {
      set('prog-colmatage', 'Désactivé', false);
    } else {
      const allBat = op.colmatage.radiers.flatMap(r => r.batonnets);
      const releve = allBat.filter(b => b.profondeur_oxy_cm != null).length;
      set('prog-colmatage', `${releve}/${allBat.length} relevés`, releve === allBat.length);
    }
    // Transects : on ne compte que les transects retenus (actifs ET non
    // supprimés). Un transect marqué "Suppression" est retiré du décompte,
    // par cohérence avec le traitement Python aval.
    const tActifs = op.transects.filter(t => this.isTransectRetenu(t));
    const tDone = tActifs.filter(t => this.isTransectComplete(t)).length;
    set('prog-transects', `${tDone}/${tActifs.length} transects`, tDone === tActifs.length && tActifs.length > 0);
  },

  // Un transect est "complet" si :
  //  - Lpb, Lm, Hpb tous renseignés
  //  - au moins 8 points de mesure (CARHYCE = 7 segments + 2 berges)
  //  - faciès affiné renseigné
  //  - matériaux des deux berges renseignés
  isTransectComplete(tr) {
    if (tr.lpb_m == null || tr.lm_m == null || tr.hpb_m == null) return false;
    if (!tr.points || tr.points.length < 8) return false;
    if (!tr.facies_affine) return false;
    if (!tr.berge_rg.materiaux || !tr.berge_rd.materiaux) return false;
    return true;
  },

  // ============================================================
  //   Règle métier : transects retenus / supprimés
  //   (symétrique de loader.est_retenu() côté traitement Python)
  // ============================================================

  // Un transect "Suppression" est retiré du protocole (ex. T2 remplacé par
  // T16) : il ne doit plus être comptabilisé ni exporté.
  // "Déplacement" (décalage de quelques cm) et "Ajout" (T16-T18) restent
  // pleinement retenus.
  isTransectSupprime(tr) {
    return (tr.modification && tr.modification.type) === 'Suppression';
  },

  // Transect pris en compte dans le traitement aval : actif ET non supprimé.
  isTransectRetenu(tr) {
    return tr.actif && !this.isTransectSupprime(tr);
  },

  // ============================================================
  //   ÉCRAN FUSION (combine deux opérations enregistrées)
  // ============================================================
  async renderFusion() {
    if (!this.state.fusion) {
      this.state.fusion = { aId: null, bId: null, sections: {}, transects: {} };
    }
    const f = this.state.fusion;
    const root = document.getElementById('form-fusion');
    root.innerHTML = '';

    const ops = await DB.list();
    if (ops.length < 2) {
      const b = document.createElement('div');
      b.className = 'info-banner';
      b.textContent = "Il faut au moins deux opérations enregistrées pour fusionner. "
        + "Importez d'abord les JSON des deux appareils (bouton « Importer un JSON » à l'accueil).";
      root.appendChild(b);
      return;
    }

    // Défauts de sélection des opérations
    if (!f.aId || !ops.some(o => o.id === f.aId)) f.aId = ops[0].id;
    if (!f.bId || !ops.some(o => o.id === f.bId) || f.bId === f.aId) {
      f.bId = (ops.find(o => o.id !== f.aId) || ops[1]).id;
    }

    // --- Sélection des deux opérations
    {
      const { section, body } = this.section('Opérations à fusionner');
      const g = this.grid();
      g.appendChild(this._fusionSelect('Opération A', ops, f.aId, id => {
        f.aId = id; f.sections = {}; f.transects = {}; this.renderFusion();
      }));
      g.appendChild(this._fusionSelect('Opération B', ops, f.bId, id => {
        f.bId = id; f.sections = {}; f.transects = {}; this.renderFusion();
      }));
      body.appendChild(g);
      root.appendChild(section);
    }

    if (f.aId === f.bId) {
      const b = document.createElement('div');
      b.className = 'warn-banner';
      b.textContent = 'Sélectionnez deux opérations différentes.';
      root.appendChild(b);
      return;
    }

    const opA = await DB.get(f.aId);
    const opB = await DB.get(f.bId);
    const sv = o => (o.meta && o.meta.schema_version) || '';
    if (sv(opA) !== '1.0' || sv(opB) !== '1.0') {
      const b = document.createElement('div');
      b.className = 'warn-banner';
      b.textContent = 'Schéma incompatible (version 1.0 attendue). Fusion impossible.';
      root.appendChild(b);
      return;
    }
    if (!Fusion.memeStation(opA, opB)) {
      const b = document.createElement('div');
      b.className = 'warn-banner';
      b.innerHTML = '⚠ Les deux opérations ne semblent pas correspondre à la même station '
        + '(code/libellé différents). Vérifiez avant de fusionner.';
      root.appendChild(b);
    }

    // Défauts : onglet -> côté le plus rempli
    Fusion.SECTIONS.forEach(s => {
      if (!f.sections[s.key]) {
        f.sections[s.key] =
          Fusion.scoreSection(opB, s.key) > Fusion.scoreSection(opA, s.key) ? 'B' : 'A';
      }
    });
    // Défauts : transect -> seul côté porteur de données (sinon aucun)
    for (let n = 1; n <= 18; n++) {
      if (f.transects[n] === undefined) {
        const da = Fusion.aDesDonnees(Fusion.trParNumero(opA, n));
        const db = Fusion.aDesDonnees(Fusion.trParNumero(opB, n));
        f.transects[n] = da && !db ? 'A' : db && !da ? 'B' : null;
      }
    }

    // --- Choix par onglet entier
    {
      const { section, body } = this.section('Onglets (choix par onglet entier)');
      Fusion.SECTIONS.forEach(s => {
        body.appendChild(this._fusionRowSection(s, opA, opB, f));
      });
      root.appendChild(section);
    }

    // Met à jour l'état du bouton Générer (réassigné dans le bloc plus bas).
    let majGen = () => {};

    // --- Choix transect par transect
    {
      const { section, body } = this.section('Transects (choix transect par transect)');
      const info = document.createElement('div');
      info.className = 'info-banner';
      info.textContent = "Cochez la source à conserver pour chaque transect (A ou B, exclusif). "
        + "Aucune case cochée = transect laissé vide.";
      body.appendChild(info);

      const wrap = document.createElement('div');
      wrap.className = 'points-table-wrapper';
      const table = document.createElement('table');
      table.className = 'points-table';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>Transect</th><th>A</th><th>État A</th>'
        + '<th>B</th><th>État B</th></tr>';
      table.appendChild(thead);
      const tb = document.createElement('tbody');
      for (let n = 1; n <= 18; n++) {
        const trA = Fusion.trParNumero(opA, n);
        const trB = Fusion.trParNumero(opB, n);
        const stA = Fusion.statutTransect(trA);
        const stB = Fusion.statutTransect(trB);
        const visible = (trA && trA.actif) || (trB && trB.actif)
          || Fusion.aDesDonnees(trA) || Fusion.aDesDonnees(trB)
          || stA.code === 'supprime' || stB.code === 'supprime';
        if (!visible) continue;
        tb.appendChild(this._fusionRowTransect(n, stA, stB, f, () => majGen()));
      }
      table.appendChild(tb);
      wrap.appendChild(table);
      body.appendChild(wrap);
      root.appendChild(section);
    }

    // --- Génération
    {
      const { section, body } = this.section('Générer');

      const warn = document.createElement('div');
      warn.className = 'warn-banner';
      warn.hidden = true;

      const btn = document.createElement('button');
      btn.className = 'primary-btn';
      btn.textContent = '✓ Générer l\'opération fusionnée';
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const gabarit = DB.newOperation();
        const merged = Fusion.assembler(
          opA, opB, { sections: f.sections, transects: f.transects }, gabarit);
        await DB.put(merged);
        this.state.fusion = null;
        this.toast('Opération fusionnée créée');
        await this.openOperation(merged.id);
      });

      // Verrou : interdit la génération tant qu'un transect porteur de données
      // n'est pas attribué à une source (évite d'en oublier un). Rafraîchi à
      // chaque clic de case via le callback passé aux lignes transect.
      majGen = () => {
        const manquants = [];
        for (let n = 1; n <= 18; n++) {
          const aDonnees = Fusion.aDesDonnees(Fusion.trParNumero(opA, n))
            || Fusion.aDesDonnees(Fusion.trParNumero(opB, n));
          const choisi = f.transects[n] === 'A' || f.transects[n] === 'B';
          if (aDonnees && !choisi) manquants.push('T' + n);
        }
        if (manquants.length) {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
          warn.hidden = false;
          warn.textContent = 'Attribuez une source (A ou B) à chaque transect porteur '
            + 'de données avant de générer, pour n\'en oublier aucun. '
            + 'À compléter : ' + manquants.join(', ') + '.';
        } else {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.cursor = '';
          warn.hidden = true;
        }
      };

      body.appendChild(warn);
      body.appendChild(btn);
      root.appendChild(section);
      majGen();   // état initial
    }
  },

  // Sélecteur d'opération (sans déclencher scheduleSave, contrairement à field()).
  _fusionSelect(label, ops, currentId, onChange) {
    const f = document.createElement('div');
    f.className = 'field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    f.appendChild(lbl);
    const sel = document.createElement('select');
    ops.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id;
      const lib = o.station.libelle || o.station.code || '(sans nom)';
      const sub = [o.station.date, o.station.operateurs].filter(Boolean).join(' · ');
      opt.textContent = sub ? `${lib} — ${sub}` : lib;
      if (o.id === currentId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    f.appendChild(sel);
    return f;
  },

  // Ligne de choix d'un onglet entier (radios A/B mutuellement exclusifs).
  _fusionRowSection(s, opA, opB, f) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '0.6rem';
    row.style.flexWrap = 'wrap';
    row.style.padding = '0.45rem 0';
    row.style.borderBottom = '1px solid var(--border)';

    const name = document.createElement('div');
    name.style.fontWeight = '600';
    name.style.minWidth = '110px';
    name.textContent = s.label;
    row.appendChild(name);

    const mk = (side, op) => {
      const lab = document.createElement('label');
      lab.style.display = 'inline-flex';
      lab.style.alignItems = 'center';
      lab.style.gap = '0.3rem';
      lab.style.fontSize = '0.85rem';
      const rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'fus_sec_' + s.key;
      rb.checked = f.sections[s.key] === side;
      rb.addEventListener('change', () => { if (rb.checked) f.sections[s.key] = side; });
      const span = document.createElement('span');
      span.textContent = `${side} — ${Fusion.completude(op, s.key)}`;
      lab.appendChild(rb);
      lab.appendChild(span);
      return lab;
    };
    row.appendChild(mk('A', opA));
    row.appendChild(mk('B', opB));
    return row;
  },

  // Ligne de choix d'un transect (cases A/B exclusives, décochables).
  _fusionRowTransect(n, stA, stB, f, onChange) {
    const tr = document.createElement('tr');
    const tdN = document.createElement('td');
    tdN.className = 'col-num';
    tdN.textContent = 'T' + n;
    tr.appendChild(tdN);

    const cbA = document.createElement('input');
    cbA.type = 'checkbox';
    cbA.checked = f.transects[n] === 'A';
    cbA.disabled = stA.code === 'absent';
    const cbB = document.createElement('input');
    cbB.type = 'checkbox';
    cbB.checked = f.transects[n] === 'B';
    cbB.disabled = stB.code === 'absent';

    cbA.addEventListener('change', () => {
      if (cbA.checked) { f.transects[n] = 'A'; cbB.checked = false; }
      else if (f.transects[n] === 'A') { f.transects[n] = null; }
      if (onChange) onChange();
    });
    cbB.addEventListener('change', () => {
      if (cbB.checked) { f.transects[n] = 'B'; cbA.checked = false; }
      else if (f.transects[n] === 'B') { f.transects[n] = null; }
      if (onChange) onChange();
    });

    const tdA = document.createElement('td'); tdA.appendChild(cbA); tr.appendChild(tdA);
    const tdSA = document.createElement('td');
    tdSA.textContent = stA.label; tdSA.style.fontSize = '0.8rem'; tr.appendChild(tdSA);
    const tdB = document.createElement('td'); tdB.appendChild(cbB); tr.appendChild(tdB);
    const tdSB = document.createElement('td');
    tdSB.textContent = stB.label; tdSB.style.fontSize = '0.8rem'; tr.appendChild(tdSB);
    return tr;
  },

  // ============================================================
  //   Sauvegarde et indicateur
  // ============================================================
  _saveTimer: null,
  async scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      await DB.put(this.state.op);
      this.flashSaved();
      this.updateProgress();
    }, 400);
  },

  flashSaved() {
    const el = document.getElementById('save-indicator');
    el.textContent = '✓ sauvé';
    el.classList.add('visible');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => el.classList.remove('visible'), 1200);
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  },

  // ============================================================
  //   Helpers de génération de champs
  // ============================================================

  field({ label, type = 'text', value, onChange, options, note, readonly, full, placeholder, inputmode, step }) {
    const f = document.createElement('div');
    f.className = 'field' + (full ? ' full' : '');
    const lbl = document.createElement('label');
    lbl.textContent = label;
    f.appendChild(lbl);

    let input;
    const isNumber = (type === 'number');
    if (type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '—';
      input.appendChild(blank);
      options.forEach(opt => {
        const o = document.createElement('option');
        if (typeof opt === 'string') {
          o.value = opt; o.textContent = opt;
        } else {
          o.value = opt.value !== undefined ? opt.value : opt.code;
          o.textContent = opt.label !== undefined ? opt.label : (opt.code ? `${opt.code} — ${opt.libelle}` : opt.libelle);
        }
        input.appendChild(o);
      });
      input.value = value == null ? '' : value;
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.value = value || '';
      if (placeholder) input.placeholder = placeholder;
    } else {
      input = document.createElement('input');
      if (isNumber) {
        // type="text" + inputmode="decimal" : accepte point ET virgule sans rejet navigateur
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
      } else {
        input.type = type;
      }
      if (placeholder) input.placeholder = placeholder;
      if (inputmode) input.inputMode = inputmode;
      if (step && !isNumber) input.step = step;
      input.value = value == null ? '' : value;
    }
    if (readonly) {
      input.readOnly = true;
      input.classList.add('readonly-field');
      input.style.background = '#eef0f4';
      input.style.color = '#666';
      input.style.cursor = 'not-allowed';
    }
    if (onChange) {
      const handler = () => {
        let v = input.value;
        if (isNumber) v = parseNum(v);
        onChange(v);
        this.scheduleSave();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    }
    f.appendChild(input);
    if (note) {
      const n = document.createElement('div');
      n.className = 'field-note';
      n.textContent = note;
      f.appendChild(n);
    }
    return f;
  },

  // Affiche un bouton « suivant » sur le clavier mobile et passe au champ de
  // saisie suivant (input uniquement, les listes déroulantes sont ignorées)
  // à l'intérieur de `container`. Pratique pour enchaîner distance/profondeur
  // et les 100 cases de granulométrie sans repointer chaque cellule.
  _wireNext(inp, container) {
    inp.enterKeyHint = 'next';
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const foci = Array.from(container.querySelectorAll('input'))
        .filter(el => el.type !== 'button' && !el.disabled && !el.readOnly
                       && !el.dataset.skipNext && el.offsetParent !== null);
      const i = foci.indexOf(inp);
      if (i > -1 && i + 1 < foci.length) {
        const nx = foci[i + 1];
        nx.focus();
        if (nx.select) nx.select();
      } else {
        inp.blur();
      }
    });
  },

  calcField({ label, value, unit, note }) {
    const f = document.createElement('div');
    f.className = 'field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    f.appendChild(lbl);
    const div = document.createElement('div');
    div.className = 'calc-value';
    div.textContent = (value == null || isNaN(value)) ? '—' : `${(+value).toFixed(2)} ${unit || ''}`;
    f.appendChild(div);
    if (note) {
      const n = document.createElement('div');
      n.className = 'field-note';
      n.textContent = note;
      f.appendChild(n);
    }
    return f;
  },

  checkboxGroup({ options, selected, onChange }) {
    const group = document.createElement('div');
    group.className = 'checkbox-group';
    // État partagé entre toutes les checkboxes du groupe.
    // On part du tableau initial fourni, et on le met à jour à chaque clic.
    // Indispensable pour permettre la sélection multiple : sans ça, chaque
    // checkbox capturait la valeur initiale de `selected` dans sa closure et
    // les coches successives s'écrasaient mutuellement.
    const etat = new Set(selected || []);
    options.forEach(opt => {
      const code = typeof opt === 'string' ? opt : opt.code;
      const label = typeof opt === 'string' ? opt : `${opt.code} — ${opt.libelle}`;
      const lbl = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = code;
      cb.checked = etat.has(code);
      cb.addEventListener('change', () => {
        if (cb.checked) etat.add(code); else etat.delete(code);
        onChange(Array.from(etat));
        this.scheduleSave();
      });
      const span = document.createElement('span');
      span.textContent = label;
      lbl.appendChild(cb);
      lbl.appendChild(span);
      group.appendChild(lbl);
    });
    return group;
  },

  section(title, { collapsible = false, collapsed = false } = {}) {
    const sec = document.createElement('div');
    sec.className = 'form-section' + (collapsible ? ' collapsible' : '') + (collapsed ? ' collapsed' : '');
    const h3 = document.createElement('h3');
    h3.textContent = title;
    sec.appendChild(h3);
    const body = document.createElement('div');
    body.className = 'form-body';
    sec.appendChild(body);
    if (collapsible) {
      h3.addEventListener('click', () => sec.classList.toggle('collapsed'));
    }
    return { section: sec, body };
  },

  grid() {
    const g = document.createElement('div');
    g.className = 'field-grid';
    return g;
  },

  // ============================================================
  //   ÉCRAN STATION
  // ============================================================
  renderStation() {
    const op = this.state.op;
    const st = op.station;
    const root = document.getElementById('form-station');
    root.innerHTML = '';

    // --- Informations générales
    {
      const { section, body } = this.section('Informations générales');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Campagne', value: st.campagne, onChange: v => st.campagne = v }));
      g.appendChild(this.field({ label: 'Code station', value: st.code, onChange: v => st.code = v, placeholder: 'ex. 06198506' }));
      g.appendChild(this.field({ label: 'Libellé station', value: st.libelle, onChange: v => st.libelle = v, full: true, placeholder: 'ex. Huveaune à Marseille 4' }));
      g.appendChild(this.field({ label: 'Cours d\'eau', value: st.cours_eau, onChange: v => st.cours_eau = v }));
      g.appendChild(this.field({ label: 'Masse d\'eau', value: st.masse_eau, onChange: v => st.masse_eau = v, full: true }));
      g.appendChild(this.field({ label: 'Date du relevé', type: 'date', value: st.date, onChange: v => st.date = v }));
      g.appendChild(this.field({ label: 'Heure', type: 'time', value: st.heure, onChange: v => st.heure = v }));
      g.appendChild(this.field({ label: 'Opérateurs', value: st.operateurs, onChange: v => st.operateurs = v, placeholder: 'ex. RREG, JNIE', full: true }));
      g.appendChild(this.field({ label: 'Conditions météorologiques', type: 'select', options: NOM.conditions_meteo, value: st.conditions_meteo, onChange: v => st.conditions_meteo = v }));
      g.appendChild(this.field({ label: 'Conditions hydrologiques', type: 'select', options: NOM.conditions_hydrologiques, value: st.conditions_hydrologiques, onChange: v => st.conditions_hydrologiques = v }));
      g.appendChild(this.field({ label: 'Échelle limnimétrique', type: 'select', options: NOM.echelle_limni, value: st.echelle_limni, onChange: v => st.echelle_limni = v }));
      g.appendChild(this.field({ label: 'Limpidité', type: 'select', options: NOM.limpidite, value: st.limpidite, onChange: v => st.limpidite = v }));
      g.appendChild(this.field({ label: 'Propriété privée', type: 'select', options: NOM.oui_non, value: st.propriete_privee, onChange: v => st.propriete_privee = v }));
      g.appendChild(this.field({ label: 'Végétation rivulaire', type: 'select', options: NOM.vegetation_rivulaire, value: st.vegetation_rivulaire, onChange: v => st.vegetation_rivulaire = v }));
      g.appendChild(this.field({ label: 'Photos amont/aval prises ?', type: 'select', options: NOM.oui_non, value: st.photos_amont_aval, onChange: v => st.photos_amont_aval = v }));
      body.appendChild(g);
      root.appendChild(section);
    }

    // --- Coordonnées : saisie GPS en WGS84 puis conversion en Lambert 93
    //     En pratique les coordonnées terrain sont toujours relevées en WGS84.
    //     Le bouton convertit en RGF93 / Lambert 93 (via geo.js) et remplit
    //     les champs X/Y, qui restent éditables manuellement si besoin.
    {
      const { section, body } = this.section('Coordonnées de la station');

      const info = document.createElement('div');
      info.className = 'info-banner';
      info.textContent = 'Saisir les coordonnées GPS en WGS84 (degrés décimaux), '
        + 'puis convertir en Lambert 93. Les champs L93 restent modifiables.';
      body.appendChild(info);

      // Saisie WGS84 (relevé GPS terrain)
      const gWgs = this.grid();
      gWgs.appendChild(this.field({ label: 'Latitude amont (WGS84, °)',  type: 'number', value: st.lat_amont, onChange: v => st.lat_amont = v, placeholder: 'ex. 43.2965' }));
      gWgs.appendChild(this.field({ label: 'Longitude amont (WGS84, °)', type: 'number', value: st.lon_amont, onChange: v => st.lon_amont = v, placeholder: 'ex. 5.3698' }));
      gWgs.appendChild(this.field({ label: 'Latitude aval (WGS84, °)',   type: 'number', value: st.lat_aval,  onChange: v => st.lat_aval = v }));
      gWgs.appendChild(this.field({ label: 'Longitude aval (WGS84, °)',  type: 'number', value: st.lon_aval,  onChange: v => st.lon_aval = v }));
      body.appendChild(gWgs);

      // Bouton de conversion WGS84 -> Lambert 93
      const convWrap = document.createElement('div');
      convWrap.className = 'card-action';
      const btnConv = document.createElement('button');
      btnConv.type = 'button';
      btnConv.className = 'primary-btn';
      btnConv.textContent = '↻ Convertir WGS84 → Lambert 93';
      btnConv.addEventListener('click', () => {
        if (typeof GEO === 'undefined') {
          this.toast('Module de conversion (geo.js) non chargé.');
          return;
        }
        const amont = GEO.wgs84ToL93(st.lat_amont, st.lon_amont);
        const aval  = GEO.wgs84ToL93(st.lat_aval,  st.lon_aval);
        if (!amont && !aval) {
          this.toast('Saisir au moins un couple latitude/longitude valide.');
          return;
        }
        if (amont) { st.x_amont = amont.x; st.y_amont = amont.y; }
        if (aval)  { st.x_aval  = aval.x;  st.y_aval  = aval.y; }
        this.renderStation();   // ré-affiche les champs L93 mis à jour
        this.scheduleSave();
        this.toast('Coordonnées converties en Lambert 93.');
      });
      convWrap.appendChild(btnConv);
      body.appendChild(convWrap);

      // Coordonnées RGF93 / Lambert 93 (résultat de la conversion, éditables)
      const gL93 = this.grid();
      gL93.appendChild(this.field({ label: 'X amont (L93, m)', type: 'number', value: st.x_amont, onChange: v => st.x_amont = v }));
      gL93.appendChild(this.field({ label: 'Y amont (L93, m)', type: 'number', value: st.y_amont, onChange: v => st.y_amont = v }));
      gL93.appendChild(this.field({ label: 'X aval (L93, m)',  type: 'number', value: st.x_aval,  onChange: v => st.x_aval = v }));
      gL93.appendChild(this.field({ label: 'Y aval (L93, m)',  type: 'number', value: st.y_aval,  onChange: v => st.y_aval = v }));
      body.appendChild(gL93);

      root.appendChild(section);
    }

    // --- Caractéristiques (Lpb-ev, Lm-ev, longueur)
    {
      const { section, body } = this.section('Largeurs d\'évaluation et longueur de station');
      body.appendChild(this.renderLpbLmBlock(st));
      root.appendChild(section);
    }

    // --- Continuité de la ripisylve
    {
      const { section, body } = this.section('Continuité longitudinale de la ripisylve');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Rive gauche', type: 'select', options: NOM.continuite_ripisylve, value: st.continuite_ripisylve_rg, onChange: v => st.continuite_ripisylve_rg = v }));
      g.appendChild(this.field({ label: 'Rive droite', type: 'select', options: NOM.continuite_ripisylve, value: st.continuite_ripisylve_rd, onChange: v => st.continuite_ripisylve_rd = v }));
      body.appendChild(g);
      root.appendChild(section);
    }

    // --- Débit et pente
    {
      const { section, body } = this.section('Débit et pente');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Débit mesuré (m³/s)', type: 'number', step: '0.001', value: st.debit_m3s, onChange: v => st.debit_m3s = v, note: 'Saisir au moins 3 décimales (ex. 0,433) pour le calcul du Strickler' }));
      g.appendChild(this.field({ label: 'Pente estimée (‰)', type: 'number', step: '0.01', value: st.pente_estimee_pourmille, onChange: v => st.pente_estimee_pourmille = v, note: 'Calcul automatique depuis l\'écran « Pente »', readonly: true }));
      g.appendChild(this.field({ label: 'Pente calculée (‰)', type: 'number', step: '0.01', value: st.pente_calculee_pourmille, onChange: v => st.pente_calculee_pourmille = v, note: 'Calcul automatique depuis l\'écran « Pente »', readonly: true }));
      body.appendChild(g);
      root.appendChild(section);
    }

    // --- Habitats non minéraux marginaux
    {
      const { section, body } = this.section('Habitats non minéraux marginaux');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Présence', type: 'select', options: NOM.oui_non, value: st.habitats_non_min_marginaux.presence, onChange: v => st.habitats_non_min_marginaux.presence = v }));
      body.appendChild(g);
      const lbl = document.createElement('label');
      lbl.style.fontWeight = '500';
      lbl.style.fontSize = '0.85rem';
      lbl.textContent = 'Habitats observés (cocher) :';
      body.appendChild(lbl);
      body.appendChild(this.checkboxGroup({
        options: NOM.substrats_additionnels,
        selected: st.habitats_non_min_marginaux.liste,
        onChange: v => st.habitats_non_min_marginaux.liste = v,
      }));
      root.appendChild(section);
    }

    // --- Remarques
    {
      const { section, body } = this.section('Remarques sur la station');
      body.appendChild(this.field({ label: 'Observations libres', type: 'textarea', value: st.remarques, onChange: v => st.remarques = v, full: true }));
      root.appendChild(section);
    }
  },

  renderLpbLmBlock(st) {
    const container = document.createElement('div');

    // 3 mesures Lpb
    const lpbRow = this.grid();
    [0,1,2].forEach(i => {
      lpbRow.appendChild(this.field({
        label: `Lpb mesure ${i+1} (m)`,
        type: 'number', step: '0.1',
        value: st.lpb_ev_mesures[i],
        onChange: v => { st.lpb_ev_mesures[i] = v; this.refreshLpbLmCalcs(); }
      }));
    });
    container.appendChild(lpbRow);

    // 3 mesures Lm
    const lmRow = this.grid();
    [0,1,2].forEach(i => {
      lmRow.appendChild(this.field({
        label: `Lm mesure ${i+1} (m)`,
        type: 'number', step: '0.1',
        value: st.lm_ev_mesures[i],
        onChange: v => { st.lm_ev_mesures[i] = v; this.refreshLpbLmCalcs(); }
      }));
    });
    container.appendChild(lmRow);

    // Calculs auto
    const calcRow = this.grid();
    const lpbEvMean = this.avg(st.lpb_ev_mesures);
    const lmEvMean  = this.avg(st.lm_ev_mesures);
    const lTheo     = lpbEvMean != null ? lpbEvMean * 14 : null;
    const dTheo     = lmEvMean  != null ? lmEvMean / 7   : null;

    this._lpbCalcRow = calcRow;
    calcRow.appendChild(this.calcField({ label: 'Lpb-ev moyen (m)', value: lpbEvMean, unit: 'm' }));
    calcRow.appendChild(this.calcField({ label: 'Lm-ev moyen (m)', value: lmEvMean, unit: 'm' }));
    calcRow.appendChild(this.calcField({ label: 'L théorique (= 14 × Lpb-ev)', value: lTheo, unit: 'm' }));
    calcRow.appendChild(this.calcField({ label: 'Distance inter-points théorique (= Lm-ev / 7)', value: dTheo, unit: 'm' }));
    container.appendChild(calcRow);

    // Longueur réelle + distance inter-points appliquée
    const realRow = this.grid();
    realRow.appendChild(this.field({
      label: 'Longueur réelle de station (m)',
      type: 'number', step: '0.1',
      value: st.longueur_reelle_m,
      onChange: v => st.longueur_reelle_m = v,
      note: 'Mesurée sur le terrain',
    }));
    realRow.appendChild(this.field({
      label: 'Distance inter-points appliquée (m)',
      type: 'number', step: '0.01',
      value: st.distance_interpoints_appliquee_m,
      onChange: v => st.distance_interpoints_appliquee_m = v,
      note: 'Souvent arrondie depuis la valeur théorique',
    }));
    container.appendChild(realRow);
    return container;
  },

  refreshLpbLmCalcs() {
    const st = this.state.op.station;
    if (!this._lpbCalcRow) return;
    const lpbEvMean = this.avg(st.lpb_ev_mesures);
    const lmEvMean  = this.avg(st.lm_ev_mesures);
    const lTheo     = lpbEvMean != null ? lpbEvMean * 14 : null;
    const dTheo     = lmEvMean  != null ? lmEvMean / 7   : null;
    const vals = [lpbEvMean, lmEvMean, lTheo, dTheo];
    this._lpbCalcRow.querySelectorAll('.calc-value').forEach((el, i) => {
      const v = vals[i];
      el.textContent = (v == null || isNaN(v)) ? '—' : `${v.toFixed(2)} m`;
    });
  },

  avg(arr) {
    const nums = arr.filter(v => v != null && v !== '' && !isNaN(v)).map(Number);
    if (nums.length === 0) return null;
    return nums.reduce((a,b)=>a+b, 0) / nums.length;
  },

  // ============================================================
  //   ÉCRAN GRANULOMÉTRIE
  // ============================================================
  renderGranulo() {
    const op = this.state.op;
    const g = op.granulometrie;
    const root = document.getElementById('form-granulo');
    root.innerHTML = '';

    // Grille de saisie 100 mesures
    {
      const { section, body } = this.section('Diamètres mesurés (mm) — 100 éléments');
      const info = document.createElement('div');
      info.className = 'info-banner';
      info.textContent = 'Saisir le diamètre perpendiculaire au plus grand axe. La grille contient 100 cases : utilisez la touche TAB pour passer d\'une case à la suivante.';
      body.appendChild(info);

      const grid = document.createElement('div');
      grid.className = 'granulo-grid';
      // S'assure que le tableau fait 100 entrées
      while (g.mesures_mm.length < 100) g.mesures_mm.push(null);
      for (let i = 0; i < 100; i++) {
        const cell = document.createElement('div');
        cell.className = 'granulo-cell';
        const num = document.createElement('span');
        num.className = 'gr-num';
        num.textContent = (i+1).toString();
        cell.appendChild(num);
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.autocomplete = 'off';
        inp.value = g.mesures_mm[i] == null ? '' : g.mesures_mm[i];
        inp.addEventListener('input', () => {
          g.mesures_mm[i] = parseNum(inp.value);
          this.refreshGranuloStats();
          this.scheduleSave();
        });
        cell.appendChild(inp);
        grid.appendChild(cell);
        this._wireNext(inp, grid);
      }
      body.appendChild(grid);

      // Statistiques
      const stats = document.createElement('div');
      stats.className = 'granulo-stats';
      stats.id = 'granulo-stats';
      body.appendChild(stats);
      this.refreshGranuloStats();
      root.appendChild(section);
    }

    // Remarques
    {
      const { section, body } = this.section('Remarques');
      body.appendChild(this.field({ label: 'Observations libres', type: 'textarea', value: g.remarques, onChange: v => g.remarques = v, full: true }));
      root.appendChild(section);
    }
  },

  refreshGranuloStats() {
    const arr = (this.state.op.granulometrie.mesures_mm || []).filter(v => v != null && !isNaN(v)).map(Number);
    const el = document.getElementById('granulo-stats');
    if (!el) return;
    const n = arr.length;
    const sorted = [...arr].sort((a,b)=>a-b);
    const pct = (p) => {
      if (n === 0) return null;
      const idx = (n - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    const d16 = pct(0.16), d50 = pct(0.5), d84 = pct(0.84);
    const ratio = (d16 && d84) ? d84/d16 : null;
    const fmt = v => (v == null) ? '—' : v.toFixed(1) + ' mm';
    el.innerHTML = '';
    const cells = [
      { label: 'N saisi', value: `${n} / 100` },
      { label: 'D16', value: fmt(d16) },
      { label: 'D50 (médian)', value: fmt(d50) },
      { label: 'D84', value: fmt(d84) },
      { label: 'D84 / D16', value: ratio == null ? '—' : ratio.toFixed(2) },
      { label: 'Min', value: fmt(arr.length ? Math.min(...arr) : null) },
      { label: 'Max', value: fmt(arr.length ? Math.max(...arr) : null) },
    ];
    cells.forEach(c => {
      const div = document.createElement('div');
      div.className = 'stat';
      div.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
      el.appendChild(div);
    });
  },

  // ============================================================
  //   ÉCRAN PENTE
  // ============================================================
  renderPente() {
    const op = this.state.op;
    const p = op.pente;
    const root = document.getElementById('form-pente');
    root.innerHTML = '';

    const info = document.createElement('div');
    info.className = 'info-banner';
    info.innerHTML = 'Pour chaque tronçon, saisir la distance et les <strong>trois fils stadimétriques</strong> (haut, médian, bas) pour la visée aval puis la visée amont. La pente est calculée à partir des Fm.';
    root.appendChild(info);

    const listSec = this.section('Tronçons');
    root.appendChild(listSec.section);
    const list = document.createElement('div');
    list.id = 'troncons-list';
    listSec.body.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.className = 'primary-btn';
    addBtn.textContent = '＋ Ajouter un tronçon';
    addBtn.style.marginTop = '0.6rem';
    addBtn.addEventListener('click', () => {
      p.troncons.push({
        n: p.troncons.length + 1,
        limite_aval: '',
        limite_amont: '',
        distance_m: null,
        aval:  { fh: null, fm: null, fb: null },
        amont: { fh: null, fm: null, fb: null },
      });
      this.refreshTroncons();
      this.scheduleSave();
    });
    listSec.body.appendChild(addBtn);

    // Calcul de pente
    const calcSec = this.section('Calcul de la pente');
    root.appendChild(calcSec.section);
    const calcWrap = document.createElement('div');
    calcWrap.id = 'pente-calc';
    calcSec.body.appendChild(calcWrap);

    this.refreshTroncons();
  },

  refreshTroncons() {
    const op = this.state.op;
    const p = op.pente;
    const list = document.getElementById('troncons-list');
    if (!list) return;
    list.innerHTML = '';

    p.troncons.forEach((tr, idx) => {
      const card = document.createElement('div');
      card.className = 'troncon-card';
      const head = document.createElement('h4');
      head.innerHTML = `<span>Tronçon ${idx+1}</span>`;
      const rm = document.createElement('button');
      rm.className = 'danger-btn';
      rm.style.padding = '0.3rem 0.6rem';
      rm.style.minHeight = '32px';
      rm.style.minWidth = '40px';
      rm.style.flex = '0';
      rm.textContent = '×';
      rm.title = 'Supprimer ce tronçon';
      rm.addEventListener('click', () => {
        if (!confirm('Supprimer ce tronçon ?')) return;
        p.troncons.splice(idx, 1);
        this.refreshTroncons();
        this.scheduleSave();
      });
      head.appendChild(rm);
      card.appendChild(head);

      const g = this.grid();
      g.appendChild(this.field({ label: 'Limite aval', value: tr.limite_aval, onChange: v => { tr.limite_aval = v; this.refreshPenteCalc(); }, placeholder: 'ex. Transect 1' }));
      g.appendChild(this.field({ label: 'Limite amont', value: tr.limite_amont, onChange: v => { tr.limite_amont = v; this.refreshPenteCalc(); }, placeholder: 'ex. Point 1' }));
      g.appendChild(this.field({ label: 'Distance (m)', type: 'number', value: tr.distance_m, onChange: v => { tr.distance_m = v; this.refreshPenteCalc(); } }));
      card.appendChild(g);

      // Visées aval : Fh / Fm / Fb avec vérification de cohérence stadimétrique sur Fm
      card.appendChild(this.buildStadimetricRow('Aval', tr.aval, () => this.refreshPenteCalc()));
      card.appendChild(this.buildStadimetricRow('Amont', tr.amont, () => this.refreshPenteCalc()));

      // Delta H du tronçon
      const dh = (tr.aval.fm != null && tr.amont.fm != null) ? (tr.aval.fm - tr.amont.fm) / 100 : null;
      const dhDiv = document.createElement('div');
      dhDiv.className = 'calc-value';
      dhDiv.style.marginTop = '0.4rem';
      dhDiv.textContent = `Δh tronçon = ${dh == null ? '—' : dh.toFixed(3) + ' m'}`;
      card.appendChild(dhDiv);

      list.appendChild(card);
    });
    this.refreshPenteCalc();
  },

  // Tolérance sur la cohérence stadimétrique : Fm doit être à ≤ 0.1 cm de (Fh+Fb)/2
  // (modifiable ici si on veut être plus laxiste sur le terrain)
  STADI_TOL_CM: 0.1,

  // Construit une ligne de saisie d'une visée (Fh / Fm / Fb) avec vérif de cohérence
  buildStadimetricRow(label, vis, onAfterChange) {
    const row = this.grid();
    const fields = {};
    ['fh', 'fm', 'fb'].forEach(k => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.textContent = `${label} — ${k.toUpperCase()} (cm)`;
      wrap.appendChild(lbl);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.autocomplete = 'off';
      inp.value = vis[k] == null ? '' : vis[k];
      inp.addEventListener('input', () => {
        vis[k] = parseNum(inp.value);
        this.checkStadi(fields, vis);
        if (onAfterChange) onAfterChange();
        this.scheduleSave();
      });
      wrap.appendChild(inp);
      const note = document.createElement('div');
      note.className = 'field-note';
      wrap.appendChild(note);
      fields[k] = { input: inp, note };
      row.appendChild(wrap);
    });
    // Vérif initiale
    this.checkStadi(fields, vis);
    return row;
  },

  checkStadi(fields, vis) {
    fields.fm.input.classList.remove('error');
    fields.fm.note.classList.remove('error');
    fields.fm.note.textContent = '';
    if (vis.fh != null && vis.fm != null && vis.fb != null) {
      const moy = (vis.fh + vis.fb) / 2;
      const ecart = Math.abs(vis.fm - moy);
      if (ecart > this.STADI_TOL_CM) {
        fields.fm.input.classList.add('error');
        fields.fm.note.classList.add('error');
        fields.fm.note.textContent = `Écart à (Fh+Fb)/2 = ${ecart.toFixed(2)} cm — vérifier la lecture`;
      }
    }
  },


  refreshPenteCalc() {
    const op = this.state.op;
    const p = op.pente;
    const wrap = document.getElementById('pente-calc');
    if (!wrap) return;
    wrap.innerHTML = '';

    // Σ Fm aval, Σ Fm amont, Σ distances
    let sFmAval = 0, sFmAmont = 0, sDist = 0, nValid = 0;
    p.troncons.forEach(tr => {
      if (tr.aval.fm != null && tr.amont.fm != null && tr.distance_m != null) {
        sFmAval += tr.aval.fm / 100;
        sFmAmont += tr.amont.fm / 100;
        sDist += tr.distance_m;
        nValid++;
      }
    });
    const dH = sFmAval - sFmAmont;
    const penteEstimee = sDist > 0 ? 1000 * dH / sDist : null;

    // Pente calculée par régression linéaire sur (distance cumulée, Δh cumulée)
    const pts = [{x: 0, y: 0}];
    let xCum = 0, yCum = 0;
    p.troncons.forEach(tr => {
      if (tr.aval.fm != null && tr.amont.fm != null && tr.distance_m != null) {
        xCum += tr.distance_m;
        yCum += (tr.aval.fm - tr.amont.fm) / 100;
        pts.push({ x: xCum, y: yCum });
      }
    });
    let slopePerMille = null;
    if (pts.length >= 2) {
      const n = pts.length;
      const sx = pts.reduce((s,p) => s + p.x, 0);
      const sy = pts.reduce((s,p) => s + p.y, 0);
      const sxx = pts.reduce((s,p) => s + p.x*p.x, 0);
      const sxy = pts.reduce((s,p) => s + p.x*p.y, 0);
      const denom = n * sxx - sx * sx;
      if (denom !== 0) slopePerMille = 1000 * (n * sxy - sx * sy) / denom;
    }

    const grid = this.grid();
    grid.appendChild(this.calcField({ label: 'Σ Fm visées aval (m)', value: sFmAval, unit: 'm' }));
    grid.appendChild(this.calcField({ label: 'Σ Fm visées amont (m)', value: sFmAmont, unit: 'm' }));
    grid.appendChild(this.calcField({ label: 'ΔH (m)', value: dH, unit: 'm' }));
    grid.appendChild(this.calcField({ label: 'Σ distances (m)', value: sDist, unit: 'm' }));
    grid.appendChild(this.calcField({ label: 'Pente estimée (‰)', value: penteEstimee, unit: '‰' }));
    grid.appendChild(this.calcField({ label: 'Pente calculée (‰)', value: slopePerMille, unit: '‰', note: 'Régression sur dist./Δh cumulés' }));
    wrap.appendChild(grid);

    // Reporter automatiquement dans la station
    if (penteEstimee != null) op.station.pente_estimee_pourmille = +penteEstimee.toFixed(3);
    if (slopePerMille != null) op.station.pente_calculee_pourmille = +slopePerMille.toFixed(3);
  },

  // ============================================================
  //   ÉCRAN COLMATAGE
  // ============================================================
  // Crée un radier vierge (id = lettre), avec 4 bâtonnets par défaut.
  _nouveauRadier(id) {
    return {
      id, lat: null, lon: null, x_l93: null, y_l93: null,
      indice_position: '', remarques: '', nb_batonnets: 4,
      batonnets: [1, 2, 3, 4].map(i => ({ code: id + i, etat: '', profondeur_oxy_cm: null })),
    };
  },

  renderColmatage() {    const op = this.state.op;
    const c = op.colmatage;
    const root = document.getElementById('form-colmatage');
    root.innerHTML = '';

    // Activation
    {
      const { section, body } = this.section('Module colmatage');
      const g = this.grid();
      g.appendChild(this.field({
        label: 'Module activé ?',
        type: 'select',
        options: NOM.oui_non,
        value: c.actif ? 'Oui' : 'Non',
        onChange: v => {
          c.actif = (v === 'Oui');
          // Re-render immédiat pour faire apparaître / disparaître la suite sans délai
          this.renderColmatage();
        }
      }));
      body.appendChild(g);
      body.appendChild(this.field({ label: 'Remarques générales', type: 'textarea', value: c.remarques, onChange: v => c.remarques = v, full: true }));
      root.appendChild(section);
    }

    if (!c.actif) return;

    // Dates pose / relève
    {
      const { section, body } = this.section('Calendrier de la mesure');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Date de pose', type: 'date', value: c.date_pose, onChange: v => c.date_pose = v }));
      g.appendChild(this.field({ label: 'Date de relève prévue', type: 'date', value: c.date_releve_prevue, onChange: v => c.date_releve_prevue = v, note: 'En général +1 mois' }));
      g.appendChild(this.field({ label: 'Date de relève effective', type: 'date', value: c.date_releve_effective, onChange: v => c.date_releve_effective = v }));
      g.appendChild(this.field({ label: 'Photos de la relève', type: 'select', options: NOM.oui_non, value: c.photos_releve, onChange: v => c.photos_releve = v }));
      body.appendChild(g);
      root.appendChild(section);
    }

    // Chaque radier : un seul encadré de coords + indice, puis une ligne par bâtonnet
    c.radiers.forEach((r) => {
      const { section, body } = this.section(`Radier ${r.id}`);

      // Encadré commun (coordonnées + indice de repérage)
      const meta = this.grid();
      meta.appendChild(this.field({ label: 'Latitude WGS84 (Dd)', type: 'number', value: r.lat, onChange: v => r.lat = v }));
      meta.appendChild(this.field({ label: 'Longitude WGS84 (Dd)', type: 'number', value: r.lon, onChange: v => r.lon = v }));
      meta.appendChild(this.field({ label: 'X L93 (m)', type: 'number', value: r.x_l93, onChange: v => r.x_l93 = v }));
      meta.appendChild(this.field({ label: 'Y L93 (m)', type: 'number', value: r.y_l93, onChange: v => r.y_l93 = v }));
      meta.appendChild(this.field({ label: 'Indice de repérage du radier', value: r.indice_position, onChange: v => r.indice_position = v, full: true, placeholder: 'ex. à 1,5 m sous bloc en RG' }));
      meta.appendChild(this.field({ label: 'Remarques radier', value: r.remarques, onChange: v => r.remarques = v, full: true }));

      // Bouton de conversion WGS84 -> L93 pour ce radier
      body.appendChild(meta);
      const convWrap = document.createElement('div');
      convWrap.className = 'card-action';
      const btnConv = document.createElement('button');
      btnConv.type = 'button';
      btnConv.className = 'secondary-btn';
      btnConv.textContent = '↻ Convertir WGS84 → L93';
      btnConv.addEventListener('click', () => {
        if (typeof GEO === 'undefined') { this.toast('Module geo.js non chargé.'); return; }
        const res = GEO.wgs84ToL93(r.lat, r.lon);
        if (!res) { this.toast('Saisir une latitude/longitude valide.'); return; }
        r.x_l93 = res.x; r.y_l93 = res.y;
        this.renderColmatage();
        this.scheduleSave();
        this.toast(`Radier ${r.id} converti en L93.`);
      });
      convWrap.appendChild(btnConv);
      body.appendChild(convWrap);

      // Nombre de bâtonnets — stepper − / + : ajout/retrait d'un bâtonnet en un
      // tap, sans saisie clavier ni validation (plus pratique sur le terrain).
      const nb = document.createElement('div');
      nb.style.display = 'flex';
      nb.style.alignItems = 'center';
      nb.style.gap = '0.6rem';
      nb.style.margin = '0.6rem 0';
      const nbLab = document.createElement('span');
      nbLab.textContent = 'Nb de bâtonnets posés :';
      nbLab.style.fontWeight = '600';
      const setN = (target) => {
        target = Math.max(1, Math.min(10, target));
        r.nb_batonnets = target;
        while (r.batonnets.length < target) {
          const i = r.batonnets.length + 1;
          r.batonnets.push({ code: r.id + i, etat: '', profondeur_oxy_cm: null });
        }
        while (r.batonnets.length > target) r.batonnets.pop();
        this.renderColmatage();
        this.scheduleSave();
      };
      const moins = document.createElement('button');
      moins.type = 'button'; moins.className = 'secondary-btn';
      moins.textContent = '−'; moins.style.minWidth = '2.6em';
      moins.disabled = r.batonnets.length <= 1;
      moins.addEventListener('click', () => setN(r.batonnets.length - 1));
      const cnt = document.createElement('span');
      cnt.textContent = r.batonnets.length;
      cnt.style.minWidth = '1.6em'; cnt.style.textAlign = 'center';
      cnt.style.fontWeight = '700'; cnt.style.fontSize = '1.1rem';
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'secondary-btn';
      plus.textContent = '+'; plus.style.minWidth = '2.6em';
      plus.disabled = r.batonnets.length >= 10;
      plus.addEventListener('click', () => setN(r.batonnets.length + 1));
      nb.append(nbLab, moins, cnt, plus);
      body.appendChild(nb);

      // Tableau compact des bâtonnets
      const table = document.createElement('table');
      table.className = 'points-table';
      table.style.minWidth = '0';
      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>Bâtonnet</th>
          <th>État</th>
          <th>Profondeur d'oxygénation (cm)</th>
        </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      r.batonnets.forEach(b => {
        const row = document.createElement('tr');

        const codeTd = document.createElement('td');
        codeTd.className = 'col-num';
        codeTd.textContent = b.code;
        row.appendChild(codeTd);

        // État
        const etatTd = document.createElement('td');
        const sel = document.createElement('select');
        const blank = document.createElement('option'); blank.value = ''; blank.textContent = '—';
        sel.appendChild(blank);
        NOM.etat_batonnet.forEach(e => {
          const o = document.createElement('option');
          o.value = e; o.textContent = e;
          sel.appendChild(o);
        });
        sel.value = b.etat || '';
        sel.addEventListener('change', () => { b.etat = sel.value; this.scheduleSave(); });
        etatTd.appendChild(sel);
        row.appendChild(etatTd);

        // Profondeur d'oxygénation
        const oxyTd = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.autocomplete = 'off';
        inp.value = b.profondeur_oxy_cm == null ? '' : b.profondeur_oxy_cm;
        inp.addEventListener('input', () => {
          b.profondeur_oxy_cm = parseNum(inp.value);
          this.refreshColmatageStats();
          this.scheduleSave();
        });
        oxyTd.appendChild(inp);
        row.appendChild(oxyTd);

        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      const wrap = document.createElement('div');
      wrap.className = 'points-table-wrapper';
      wrap.appendChild(table);
      body.appendChild(wrap);

      // Moyenne du radier — élément ciblé pour mise à jour en direct
      const synth = document.createElement('div');
      synth.className = 'calc-value';
      synth.dataset.radierMean = r.id;
      synth.style.marginTop = '0.5rem';
      body.appendChild(synth);

      // Suppression de ce radier
      const delWrap = document.createElement('div');
      delWrap.className = 'card-action';
      delWrap.style.marginTop = '0.6rem';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'secondary-btn';
      delBtn.textContent = `🗑 Supprimer le radier ${r.id}`;
      delBtn.addEventListener('click', () => {
        if (!confirm(`Supprimer définitivement le radier ${r.id} et ses ${r.batonnets.length} bâtonnet(s) ?`)) return;
        const i = c.radiers.indexOf(r);
        if (i > -1) c.radiers.splice(i, 1);
        this.renderColmatage();
        this.scheduleSave();
        this.toast(`Radier ${r.id} supprimé`);
      });
      delWrap.appendChild(delBtn);
      body.appendChild(delWrap);

      root.appendChild(section);
    });

    // Ajout d'un radier
    {
      const addWrap = document.createElement('div');
      addWrap.className = 'card-action';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'primary-btn';
      addBtn.textContent = '＋ Ajouter un radier';
      addBtn.addEventListener('click', () => {
        const used = c.radiers.map(r => (r.id || 'A').charCodeAt(0));
        const code = String.fromCharCode((used.length ? Math.max(...used) : 64) + 1);
        c.radiers.push(this._nouveauRadier(code));
        this.renderColmatage();
        this.scheduleSave();
        this.toast(`Radier ${code} ajouté`);
      });
      addWrap.appendChild(addBtn);
      root.appendChild(addWrap);
    }

    // Synthèse globale
    {
      const { section, body } = this.section('Synthèse globale');
      const wrap = document.createElement('div');
      wrap.id = 'colmatage-synth';
      body.appendChild(wrap);
      root.appendChild(section);
    }

    // Calcul initial des moyennes
    this.refreshColmatageStats();
  },

  // Mise à jour en temps réel des moyennes de colmatage
  refreshColmatageStats() {
    const c = this.state.op.colmatage;
    if (!c.actif) return;
    // Moyenne par radier
    c.radiers.forEach(r => {
      const el = document.querySelector(`[data-radier-mean="${r.id}"]`);
      if (!el) return;
      const vals = r.batonnets.filter(b => b.profondeur_oxy_cm != null).map(b => +b.profondeur_oxy_cm);
      const moy = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      el.textContent = `Moyenne radier ${r.id} : ${moy == null ? '—' : moy.toFixed(2) + ' cm'} (${vals.length} bâtonnet${vals.length>1?'s':''} relevé${vals.length>1?'s':''})`;
    });
    // Synthèse globale
    const synth = document.getElementById('colmatage-synth');
    if (!synth) return;
    synth.innerHTML = '';
    const all = c.radiers.flatMap(r => r.batonnets).filter(b => b.profondeur_oxy_cm != null).map(b => +b.profondeur_oxy_cm);
    const moy = all.length ? all.reduce((a,b)=>a+b,0)/all.length : null;
    const sd = (all.length && moy != null) ? Math.sqrt(all.reduce((s,v)=>s+(v-moy)**2,0)/all.length) : null;
    const cv = (moy != null && moy !== 0 && sd != null) ? sd/moy : null;
    const g = this.grid();
    g.appendChild(this.calcField({ label: 'Moyenne globale (cm)', value: moy, unit: 'cm' }));
    g.appendChild(this.calcField({ label: 'Écart-type (cm)', value: sd, unit: 'cm' }));
    g.appendChild(this.calcField({ label: 'Coef. de variation', value: cv == null ? null : cv * 100, unit: '%' }));
    synth.appendChild(g);
  },

  // ============================================================
  //   ÉCRAN LISTE TRANSECTS
  // ============================================================
  openTransects() {
    const op = this.state.op;
    const list = document.getElementById('transect-list');
    list.innerHTML = '';
    op.transects.forEach((tr, idx) => {
      const li = document.createElement('li');
      const supprime = this.isTransectSupprime(tr);
      // Un transect supprimé OU désactivé est grisé dans la liste.
      if (!tr.actif || supprime) li.classList.add('inactive');
      const num = document.createElement('span');
      num.className = 't-num';
      num.textContent = 'T' + tr.numero;
      const info = document.createElement('span');
      info.className = 't-info';
      const npts = tr.points.length;
      // Le statut "supprimé" prime sur tout : le transect est retiré du
      // protocole et ne sera ni comptabilisé ni exporté.
      const status = supprime ? 'supprimé'
        : !tr.actif ? 'désactivé'
        : this.isTransectComplete(tr) ? 'complet'
        : (npts > 0 || tr.lpb_m) ? 'partiel'
        : 'à saisir';
      info.innerHTML = supprime
        ? `<strong>Transect supprimé</strong><br><small>${tr.modification.raison || 'retiré du protocole'}</small>`
        : `<strong>${tr.facies_affine || tr.facies_simplifie || '—'}</strong><br><small>${npts} points · Lpb=${tr.lpb_m ?? '—'} m</small>`;
      const st = document.createElement('span');
      st.className = 't-status ' + (status === 'complet' ? 'done'
        : status === 'partiel' ? 'partial'
        : status === 'supprimé' ? 'supprime'
        : 'todo');
      st.textContent = status === 'supprimé' ? '✕'
        : status === 'désactivé' ? '○'
        : status === 'complet' ? '✓'
        : status === 'partiel' ? '…'
        : '·';
      const tog = document.createElement('button');
      tog.className = 'secondary-btn';
      tog.style.flex = '0';
      tog.style.minWidth = '50px';
      tog.style.minHeight = '34px';
      tog.style.padding = '0.2rem 0.5rem';
      tog.style.fontSize = '0.8rem';
      tog.textContent = tr.actif ? 'ON' : 'OFF';
      tog.addEventListener('click', (e) => {
        e.stopPropagation();
        tr.actif = !tr.actif;
        this.scheduleSave();
        this.openTransects();
      });
      li.appendChild(num);
      li.appendChild(info);
      li.appendChild(st);
      li.appendChild(tog);
      li.addEventListener('click', () => {
        if (!tr.actif) {
          if (!confirm(`Le transect T${tr.numero} est désactivé. L'activer et l'éditer ?`)) return;
          tr.actif = true;
        }
        this.openTransectEdit(idx);
      });
      list.appendChild(li);
    });
    this.showScreen('transects');
  },

  // ============================================================
  //   ÉCRAN ÉDITION TRANSECT
  // ============================================================
  openTransectEdit(idx) {
    this.state.currentTransect = idx;
    const tr = this.state.op.transects[idx];
    // Hériter automatiquement la distance inter-points appliquée de la station si non saisie au transect
    if (tr.distance_interpoints_appliquee_m == null) {
      const stD = this.state.op.station.distance_interpoints_appliquee_m;
      if (stD != null) tr.distance_interpoints_appliquee_m = stD;
    }
    document.getElementById('transect-edit-title').textContent = `Transect T${tr.numero}`;
    this.renderTransect();
    this.showScreen('transect-edit');
  },

  renderTransect() {
    const op = this.state.op;
    const tr = op.transects[this.state.currentTransect];
    const root = document.getElementById('form-transect');
    root.innerHTML = '';

    // --- Caractéristiques générales
    {
      const { section, body } = this.section('Caractéristiques du transect');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Rive de départ', type: 'select', options: NOM.rive, value: tr.rive_depart, onChange: v => tr.rive_depart = v, note: 'Rive où débute la mesure' }));
      g.appendChild(this.field({ label: 'Lpb — Largeur plein bord (m)', type: 'number', value: tr.lpb_m, onChange: v => { tr.lpb_m = v; this.refreshTransectCalc(); } }));
      g.appendChild(this.field({ label: 'Lm — Largeur mouillée (m)', type: 'number', value: tr.lm_m, onChange: v => { tr.lm_m = v; this.refreshTransectCalc(); } }));
      // Hpb : au changement (commit), recaler les profondeurs HORS D'EAU
      // (négatives, lues à la mire) de (Hpb_avant − Hpb_après)·100, ce qui
      // préserve les lectures mire. Les points EN EAU (positifs, saisis
      // directement sous la surface) ne dépendent pas de Hpb : on n'y touche pas.
      const hpbFld = this.field({ label: 'Hpb — Hauteur plein bord (m)', type: 'number', value: tr.hpb_m, onChange: v => { tr.hpb_m = v; this.refreshTransectCalc(); } });
      const hpbInp = hpbFld.querySelector('input');
      let _hpbAvant = tr.hpb_m;
      if (hpbInp) {
        hpbInp.addEventListener('focus', () => { _hpbAvant = tr.hpb_m; });
        hpbInp.addEventListener('change', () => {
          const avant = _hpbAvant, apres = tr.hpb_m;
          _hpbAvant = apres;
          if (avant == null || apres == null) return;
          const dCm = Math.round(avant * 100) - Math.round(apres * 100);
          if (dCm === 0) return;
          const aDecaler = tr.points.filter(p => p.profondeur_cm != null && p.profondeur_cm < 0);
          if (!aDecaler.length) return;
          const ok = confirm(
            `Hpb modifié (${avant} → ${apres} m).\n\n`
            + `Recaler les ${aDecaler.length} profondeur(s) hors d'eau (points négatifs, `
            + `lus à la mire) avec le nouveau Hpb ? Les lectures mire sont conservées ; `
            + `les points en eau (positifs) ne changent pas.`);
          if (!ok) return;
          aDecaler.forEach(p => { p.profondeur_cm = +(p.profondeur_cm + dCm).toFixed(2); });
          this.renderTransect();
          this.scheduleSave();
        });
      }
      g.appendChild(hpbFld);
      body.appendChild(g);

      // Distance inter-points appliquée + Peau sur la même ligne
      const distPeauRow = this.grid();
      distPeauRow.appendChild(this.field({
        label: 'Distance inter-points appliquée (m)',
        type: 'number',
        value: tr.distance_interpoints_appliquee_m,
        onChange: v => tr.distance_interpoints_appliquee_m = v,
        note: 'Reprise auto depuis l\'onglet Station',
      }));
      const peauWrap = document.createElement('div');
      peauWrap.id = 'peau-calc';
      distPeauRow.appendChild(peauWrap);
      body.appendChild(distPeauRow);

      const g2 = this.grid();
      g2.appendChild(this.field({ label: 'Modification du transect', type: 'select', options: NOM.modification_transect, value: tr.modification.type, onChange: v => { tr.modification.type = v; this.refreshModificationNote(); } }));
      g2.appendChild(this.field({ label: 'Raison de la modification', value: tr.modification.raison, onChange: v => tr.modification.raison = v }));
      body.appendChild(g2);

      // Bandeau explicatif selon le type de modification choisi :
      // rappelle à l'opérateur l'incidence d'un "Suppression" sur le traitement.
      const noteWrap = document.createElement('div');
      noteWrap.id = 'modification-note';
      body.appendChild(noteWrap);

      root.appendChild(section);
      this.refreshModificationNote();
    }

    // --- Points de mesure (lit)
    {
      const { section, body } = this.section('Points de mesure dans le lit');
      const tools = document.createElement('div');
      tools.className = 'points-actions';
      const addBtn = document.createElement('button');
      addBtn.className = 'primary';
      addBtn.textContent = '＋ Ajouter un point';
      addBtn.addEventListener('click', () => {
        const lastDist = tr.points.length ? tr.points[tr.points.length - 1].distance_m : 0;
        const step = tr.distance_interpoints_appliquee_m || this.state.op.station.distance_interpoints_appliquee_m || 1;
        // Premier point (transect vide) : distance = 0, substrat verrouillé à "-"
        // Points suivants : substrat par défaut TV (modifiable)
        const estPremier = tr.points.length === 0;
        tr.points.push({
          distance_m: estPremier ? 0 : (lastDist != null ? +lastDist : 0) + step,
          profondeur_cm: estPremier && tr.hpb_m != null ? -Math.round(tr.hpb_m * 100) : null,
          substrat_min: estPremier ? '-' : 'TV',
          substrat_add_1: '',
          substrat_add_2: '',
        });
        this.renderTransect();
        this.scheduleSave();
      });
      tools.appendChild(addBtn);

      const seedBtn = document.createElement('button');
      seedBtn.textContent = '⚡ Pré-remplir';
      seedBtn.title = 'Crée des points à intervalle régulier sur la largeur plein bord, avec le premier point à -Hpb';
      seedBtn.addEventListener('click', () => {
        if (!tr.lpb_m) { alert('Saisir d\'abord Lpb.'); return; }
        const step = tr.distance_interpoints_appliquee_m || this.state.op.station.distance_interpoints_appliquee_m;
        if (!step) { alert('Saisir d\'abord la distance inter-points appliquée.'); return; }
        if (tr.points.length > 0 && !confirm('Remplacer les points existants ?')) return;
        tr.points = [];
        let d = 0;
        let first = true;
        while (d <= tr.lpb_m + 1e-6) {
          // Premier point : profondeur = -Hpb (haut de berge), substrat verrouillé à "-"
          // (pas de substrat applicable hors d'eau)
          let prof = null;
          let substr = 'TV';
          if (first) {
            if (tr.hpb_m != null) prof = -Math.round(tr.hpb_m * 100);
            substr = '-';
          }
          tr.points.push({
            distance_m: +d.toFixed(2),
            profondeur_cm: prof,
            substrat_min: substr,
            substrat_add_1: '',
            substrat_add_2: '',
          });
          d += step;
          first = false;
        }
        this.renderTransect();
        this.scheduleSave();
      });
      tools.appendChild(seedBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'danger';
      clearBtn.textContent = '🗑 Vider';
      clearBtn.addEventListener('click', () => {
        if (!confirm('Supprimer tous les points de ce transect ?')) return;
        tr.points = [];
        this.renderTransect();
        this.scheduleSave();
      });
      tools.appendChild(clearBtn);
      body.appendChild(tools);

      // Aide : rappelle l'usage de la colonne d'appoint « Lecture mire ».
      const mireHint = document.createElement('div');
      mireHint.textContent = 'Remplir la colonne « Lecture mire » (en vert) pour obtenir automatiquement la profondeur.';
      mireHint.style.fontSize = '0.8rem';
      mireHint.style.color = '#2e7d32';
      mireHint.style.margin = '2px 0 6px';
      body.appendChild(mireHint);

      // Tableau des points
      const wrap = document.createElement('div');
      wrap.className = 'points-table-wrapper';
      const table = document.createElement('table');
      table.className = 'points-table';
      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>n°</th>
          <th>Distance (m)</th>
          <th style="color:#1b5e20">Lecture mire (cm)<br><small>hauteur sous le plein bord</small></th>
          <th>Profondeur (cm)<br><small>négatif = berge / hors d'eau</small></th>
          <th>Substrat min.</th>
          <th>Add. 1</th>
          <th>Add. 2</th>
          <th></th>
        </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');

      tr.points.forEach((pt, i) => {
        const row = document.createElement('tr');
        const numTd = document.createElement('td');
        numTd.className = 'col-num';
        numTd.textContent = i;
        row.appendChild(numTd);

        // Distance
        const distTd = document.createElement('td');
        distTd.className = 'col-dist';
        const dInp = document.createElement('input');
        dInp.type = 'text'; dInp.inputMode = 'decimal'; dInp.autocomplete = 'off';
        dInp.value = pt.distance_m == null ? '' : pt.distance_m;
        dInp.addEventListener('input', () => {
          pt.distance_m = parseNum(dInp.value);
          this.refreshProfileChart();
          this.scheduleSave();
        });
        distTd.appendChild(dInp);
        row.appendChild(distTd);
        this._wireNext(dInp, table);

        // Colonne d'appoint « Lecture mire » (verte) : hauteur lue sous le plein
        // bord (L, positive vers le chenal). profondeur = L − Hpb·100.
        // Non stockée dans le JSON : seulement une aide de saisie, re-dérivée de
        // la profondeur (= profondeur + Hpb·100) à la réouverture.
        const mireTd = document.createElement('td');
        mireTd.className = 'col-mire';
        mireTd.style.minWidth = '46px';
        const mInp = document.createElement('input');
        mInp.type = 'text'; mInp.inputMode = 'decimal'; mInp.autocomplete = 'off';
        mInp.dataset.skipNext = '1';   // hors enchaînement « suivant »
        mInp.style.width = '100%';
        mInp.style.background = '#e8f5e9';
        mInp.style.border = '1px solid #4caf50';
        mInp.style.color = '#1b5e20';
        const _offsetMire = () => (tr.hpb_m != null ? Math.round(tr.hpb_m * 100) : null);
        const _oInit = _offsetMire();
        mInp.value = (pt.profondeur_cm != null && _oInit != null)
          ? +(pt.profondeur_cm + _oInit).toFixed(2) : '';
        if (tr.hpb_m == null) {
          mInp.disabled = true;
          mInp.title = 'Renseigner Hpb (hauteur plein bord) pour utiliser la lecture mire';
          mInp.style.background = '#eef0f4';
          mInp.style.borderColor = '#ccc';
          mInp.style.color = '#999';
        }
        mireTd.appendChild(mInp);
        row.appendChild(mireTd);

        // Profondeur — bouton ± à gauche pour inverser le signe
        // (les claviers numériques mobiles n'affichent pas toujours le -)
        const profTd = document.createElement('td');
        profTd.className = 'col-prof';
        // Largeur suffisante pour le bouton ± plus « -NNN » (jusqu'à 3 chiffres).
        profTd.style.minWidth = '104px';
        const profWrap = document.createElement('div');
        profWrap.style.display = 'flex';
        profWrap.style.gap = '2px';
        profWrap.style.alignItems = 'stretch';

        const signBtn = document.createElement('button');
        signBtn.type = 'button';
        signBtn.textContent = '±';
        signBtn.title = 'Inverser le signe (positif ↔ négatif)';
        signBtn.style.padding = '0';
        signBtn.style.width = '28px';
        signBtn.style.minHeight = '36px';
        signBtn.style.fontSize = '1rem';
        signBtn.style.fontWeight = '700';
        signBtn.style.background = '#eef3f8';
        signBtn.style.border = '1px solid var(--border-dark)';
        signBtn.style.borderRadius = '4px';
        signBtn.style.cursor = 'pointer';
        signBtn.style.color = 'var(--primary-dk)';
        signBtn.style.flex = '0 0 28px';

        const pInp = document.createElement('input');
        pInp.type = 'text'; pInp.inputMode = 'decimal'; pInp.autocomplete = 'off';
        pInp.value = pt.profondeur_cm == null ? '' : pt.profondeur_cm;
        pInp.style.flex = '1';
        pInp.style.minWidth = '3.6em';
        pInp.addEventListener('input', () => {
          pt.profondeur_cm = parseNum(pInp.value);
          // refléter dans la colonne d'appoint (lecture = profondeur + Hpb·100)
          const o = tr.hpb_m != null ? Math.round(tr.hpb_m * 100) : null;
          if (o != null) mInp.value = pt.profondeur_cm == null ? '' : +(pt.profondeur_cm + o).toFixed(2);
          this.refreshProfileChart();
          this.refreshTransectCalc();
          this.scheduleSave();
        });

        // Saisie via la lecture mire → calcule la profondeur (= L − Hpb·100).
        mInp.addEventListener('input', () => {
          const o = tr.hpb_m != null ? Math.round(tr.hpb_m * 100) : null;
          if (o == null) return;
          const L = parseNum(mInp.value);
          pt.profondeur_cm = (L == null) ? null : +(L - o).toFixed(2);
          pInp.value = pt.profondeur_cm == null ? '' : pt.profondeur_cm;
          this.refreshProfileChart();
          this.refreshTransectCalc();
          this.scheduleSave();
        });

        signBtn.addEventListener('click', () => {
          // Si pas de valeur : on prépare une saisie négative
          if (pt.profondeur_cm == null) {
            pInp.value = '-';
            pInp.focus();
            return;
          }
          // Sinon on inverse le signe
          pt.profondeur_cm = -pt.profondeur_cm;
          pInp.value = pt.profondeur_cm;
          const o = tr.hpb_m != null ? Math.round(tr.hpb_m * 100) : null;
          if (o != null) mInp.value = pt.profondeur_cm == null ? '' : +(pt.profondeur_cm + o).toFixed(2);
          this.refreshProfileChart();
          this.refreshTransectCalc();
          this.scheduleSave();
        });

        profWrap.appendChild(signBtn);
        profWrap.appendChild(pInp);
        profTd.appendChild(profWrap);
        row.appendChild(profTd);
        this._wireNext(pInp, table);

        // Substrat principal
        // - Pour le premier point du transect (distance = 0, sur la berge) :
        //   pas de substrat applicable, on force "-" et on verrouille la cellule.
        // - Pour les autres points : valeur par défaut TV, modifiable librement.
        const estPremierPoint = (i === 0);
        const sTd = document.createElement('td');
        const sSel = document.createElement('select');
        // On ajoute toujours l'option "-" en tête, et c'est la seule possible
        // pour le premier point.
        const optTiret = document.createElement('option');
        optTiret.value = '-';
        optTiret.textContent = '-';
        sSel.appendChild(optTiret);
        NOM.substrats_mineraux.forEach(s => {
          const o = document.createElement('option');
          o.value = s.code; o.textContent = `${s.code} — ${s.libelle}`;
          sSel.appendChild(o);
        });
        if (estPremierPoint) {
          pt.substrat_min = '-';
          sSel.value = '-';
          sSel.disabled = true;
          sSel.title = 'Le premier point est sur la berge : pas de substrat applicable';
        } else {
          if (!pt.substrat_min || pt.substrat_min === '-') pt.substrat_min = 'TV';
          sSel.value = pt.substrat_min;
          sSel.addEventListener('change', () => { pt.substrat_min = sSel.value; this.scheduleSave(); });
        }
        sTd.appendChild(sSel);
        row.appendChild(sTd);

        // Additionnel 1
        const a1Td = document.createElement('td');
        a1Td.style.minWidth = '48px';
        const a1Sel = document.createElement('select');
        a1Sel.style.minWidth = '3.4em';
        const a1Blank = document.createElement('option'); a1Blank.value=''; a1Blank.textContent='—';
        a1Sel.appendChild(a1Blank);
        NOM.substrats_additionnels.forEach(s => {
          const o = document.createElement('option');
          o.value = s.code; o.textContent = s.code;
          o.title = s.libelle;
          a1Sel.appendChild(o);
        });
        a1Sel.value = pt.substrat_add_1 || '';
        a1Sel.addEventListener('change', () => { pt.substrat_add_1 = a1Sel.value; this.scheduleSave(); });
        a1Td.appendChild(a1Sel);
        row.appendChild(a1Td);

        // Additionnel 2
        const a2Td = document.createElement('td');
        a2Td.style.minWidth = '48px';
        const a2Sel = a1Sel.cloneNode(true);
        a2Sel.value = pt.substrat_add_2 || '';
        a2Sel.addEventListener('change', () => { pt.substrat_add_2 = a2Sel.value; this.scheduleSave(); });
        a2Td.appendChild(a2Sel);
        row.appendChild(a2Td);

        // Suppression
        const rmTd = document.createElement('td');
        const rmBtn = document.createElement('button');
        rmBtn.textContent = '×';
        rmBtn.title = 'Supprimer ce point';
        rmBtn.style.padding = '0.3rem 0.5rem';
        rmBtn.style.minHeight = '30px';
        rmBtn.style.color = 'var(--danger)';
        rmBtn.style.border = '1px solid var(--danger)';
        rmBtn.style.background = 'white';
        rmBtn.style.borderRadius = '6px';
        rmBtn.style.cursor = 'pointer';
        rmBtn.addEventListener('click', () => {
          tr.points.splice(i, 1);
          this.renderTransect();
          this.scheduleSave();
        });
        rmTd.appendChild(rmBtn);
        row.appendChild(rmTd);

        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);

      // Aperçu graphique profil en travers
      const chart = document.createElement('div');
      chart.className = 'profile-chart';
      chart.id = 'profile-chart';
      body.appendChild(chart);

      root.appendChild(section);
    }

    // --- Faciès
    {
      const { section, body } = this.section('Faciès d\'écoulement');
      const g = this.grid();
      g.appendChild(this.field({ label: 'Faciès simplifié', type: 'select', options: NOM.facies_simplifie, value: tr.facies_simplifie, onChange: v => tr.facies_simplifie = v }));
      g.appendChild(this.field({ label: 'Faciès affiné (Malavoi)', type: 'select', options: NOM.facies_affine, value: tr.facies_affine, onChange: v => tr.facies_affine = v }));
      body.appendChild(g);
      root.appendChild(section);
    }

    // --- Ripisylve RG / RD
    ['rg', 'rd'].forEach(rive => {
      const r = tr['ripisylve_' + rive];
      const label = rive === 'rg' ? 'Rive gauche' : 'Rive droite';
      const { section, body } = this.section(`Ripisylve — ${label}`, { collapsible: true, collapsed: true });
      NOM.strates_ripisylve.forEach(strate => {
        const key = strate.toLowerCase().replace('é','e');
        const sk = key === 'arboree' ? 'arboree' : key === 'arbustive' ? 'arbustive' : 'herbacee';
        const data = r[sk];
        const sub = document.createElement('div');
        sub.style.borderBottom = '1px dashed var(--border)';
        sub.style.paddingBottom = '0.5rem';
        sub.style.marginBottom = '0.5rem';
        const h = document.createElement('h4');
        h.textContent = `Strate ${strate.toLowerCase()}`;
        sub.appendChild(h);
        const g = this.grid();
        g.appendChild(this.field({
          label: 'Épaisseur',
          type: 'select',
          options: NOM.epaisseur_strate,
          value: data.epaisseur,
          onChange: v => {
            data.epaisseur = v;
            // "Présente" est dérivé de l'épaisseur : Absente ou vide → non présente, sinon présente
            data.presente = !!(v && v !== 'Absente');
          }
        }));
        g.appendChild(this.field({ label: 'Type de végétation', type: 'select', options: NOM.type_vegetation, value: data.type, onChange: v => data.type = v }));
        sub.appendChild(g);
        body.appendChild(sub);
      });
      const g = this.grid();
      // La strate la plus recouvrante ne peut être qu'arborée ou arbustive :
      // on exclut l'herbacée de la liste déroulante.
      const optsRecouvrante = (NOM.strate_plus_recouvrante || []).filter(o =>
        !/herbac/i.test(typeof o === 'string' ? o : (o.label || o.libelle || o.value || o.code || '')));
      g.appendChild(this.field({ label: 'Strate la plus recouvrante', type: 'select', options: optsRecouvrante, value: r.plus_recouvrante, onChange: v => r.plus_recouvrante = v }));
      body.appendChild(g);
      root.appendChild(section);
    });

    // --- Berges RG / RD
    ['rg', 'rd'].forEach(rive => {
      const b = tr['berge_' + rive];
      const label = rive === 'rg' ? 'Rive gauche' : 'Rive droite';
      const { section, body } = this.section(`Berge — ${label}`, { collapsible: true, collapsed: true });
      const g = this.grid();
      g.appendChild(this.field({ label: 'Nature des matériaux', type: 'select', options: NOM.materiaux_berges, value: b.materiaux, onChange: v => b.materiaux = v, full: true }));
      body.appendChild(g);
      const lbl = document.createElement('label');
      lbl.style.fontWeight = '500'; lbl.style.fontSize = '0.85rem';
      lbl.textContent = 'Habitats caractéristiques :';
      body.appendChild(lbl);
      body.appendChild(this.checkboxGroup({
        options: NOM.habitats_berges,
        selected: b.habitats,
        onChange: v => b.habitats = v,
      }));
      root.appendChild(section);
    });

    // --- Remarques
    {
      const { section, body } = this.section('Remarques sur le transect');
      body.appendChild(this.field({ label: 'Observations libres', type: 'textarea', value: tr.remarques, onChange: v => tr.remarques = v, full: true }));
      root.appendChild(section);
    }

    this.refreshTransectCalc();
    this.refreshProfileChart();
  },

  // Affiche un bandeau d'avertissement quand le transect est marqué
  // "Suppression" : rappelle qu'il sera exclu des calculs, figures et PDF.
  refreshModificationNote() {
    const wrap = document.getElementById('modification-note');
    if (!wrap) return;
    const tr = this.state.op.transects[this.state.currentTransect];
    wrap.innerHTML = '';
    const type = tr.modification && tr.modification.type;
    if (type === 'Suppression') {
      const banner = document.createElement('div');
      banner.className = 'warn-banner';
      banner.innerHTML = '⚠ Ce transect est marqué <strong>Suppression</strong> : '
        + 'il sera <strong>exclu</strong> des calculs, des figures et du PDF '
        + '(données conservées dans le JSON, mais non comptabilisées). '
        + 'À utiliser lorsqu\'un transect est retiré du protocole et remplacé par un autre.';
      wrap.appendChild(banner);
    }
  },

  refreshTransectCalc() {
    const tr = this.state.op.transects[this.state.currentTransect];
    if (!tr) return;
    // Peau = moyenne des profondeurs > 0 (points sous l'eau)
    const profs = tr.points.filter(p => p.profondeur_cm != null && p.profondeur_cm > 0).map(p => p.profondeur_cm / 100);
    const peau = profs.length ? profs.reduce((a,b)=>a+b,0)/profs.length : null;
    const el = document.getElementById('peau-calc');
    if (el) {
      el.innerHTML = '';
      // calcField encapsulé pour s'intégrer dans la grille
      const cf = this.calcField({ label: 'Peau — Profondeur d\'eau moyenne (m)', value: peau, unit: 'm', note: 'Moyenne des profondeurs > 0' });
      // On reproduit la structure interne d'un .field pour rester aligné avec la distance inter-points
      el.className = cf.className;
      while (cf.firstChild) el.appendChild(cf.firstChild);
    }
  },

  // ============================================================
  //   GRAPHIQUE SVG : profil en travers
  // ============================================================
  refreshProfileChart() {
    const tr = this.state.op.transects[this.state.currentTransect];
    const root = document.getElementById('profile-chart');
    if (!root) return;
    root.innerHTML = '';

    const pts = tr.points
      .filter(p => p.distance_m != null && p.profondeur_cm != null)
      .map(p => ({ x: +p.distance_m, y: -p.profondeur_cm / 100 }))
      // y en m, signé : profondeur saisie positive (sous l'eau) → y < 0 ; profondeur saisie négative (au-dessus de l'eau) → y > 0
      .sort((a,b) => a.x - b.x);

    if (pts.length < 2) {
      const msg = document.createElement('div');
      msg.className = 'muted small';
      msg.textContent = 'Profil en travers : saisir au moins 2 points pour afficher l\'aperçu.';
      msg.style.padding = '0.4rem';
      root.appendChild(msg);
      return;
    }

    const W = 700, H = 240;
    const pad = { l: 50, r: 20, t: 20, b: 36 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;

    // X : on force le début à 0 (premier point = rive de départ, distance = 0)
    const xMax = Math.max(...pts.map(p => p.x), 0);
    const x0 = 0, x1 = xMax + (xMax * 0.02 || 0.5);

    const yMin = Math.min(...pts.map(p => p.y), 0);
    const yMax = Math.max(...pts.map(p => p.y), 0);
    const yPad = (yMax - yMin) * 0.1 || 0.2;
    const y0 = yMin - yPad, y1 = yMax + yPad;

    const xScale = x => pad.l + (x - x0) / (x1 - x0) * innerW;
    const yScale = y => pad.t + (y1 - y) / (y1 - y0) * innerH;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // Clip-paths : sépare la zone sous la ligne d'eau (bleu) de la zone hors d'eau (marron)
    const ySurface = yScale(0);
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <clipPath id="clip-eau"><rect x="${pad.l}" y="${ySurface}" width="${innerW}" height="${Math.max(0, H - pad.b - ySurface)}"/></clipPath>
      <clipPath id="clip-air"><rect x="${pad.l}" y="${pad.t}" width="${innerW}" height="${Math.max(0, ySurface - pad.t)}"/></clipPath>
    `;
    svg.appendChild(defs);

    // Grille horizontale
    for (let i = 0; i <= 4; i++) {
      const y = y0 + (y1 - y0) * i / 4;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', pad.l); line.setAttribute('x2', W - pad.r);
      line.setAttribute('y1', yScale(y)); line.setAttribute('y2', yScale(y));
      line.setAttribute('class', 'grid');
      svg.appendChild(line);
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', pad.l - 6); txt.setAttribute('y', yScale(y) + 3);
      txt.setAttribute('text-anchor', 'end');
      txt.setAttribute('class', 'label');
      txt.textContent = y.toFixed(2) + ' m';
      svg.appendChild(txt);
    }

    // Axe X
    const axisX = document.createElementNS(svgNS, 'line');
    axisX.setAttribute('x1', pad.l); axisX.setAttribute('x2', W - pad.r);
    axisX.setAttribute('y1', H - pad.b); axisX.setAttribute('y2', H - pad.b);
    axisX.setAttribute('class', 'axis');
    svg.appendChild(axisX);

    // Étiquettes axe X
    const nbXLab = Math.min(8, pts.length);
    for (let i = 0; i < nbXLab; i++) {
      const xv = x0 + (x1 - x0) * i / (nbXLab - 1);
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', xScale(xv)); txt.setAttribute('y', H - pad.b + 16);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('class', 'label');
      txt.textContent = xv.toFixed(1);
      svg.appendChild(txt);
    }
    const xLab = document.createElementNS(svgNS, 'text');
    xLab.setAttribute('x', (W - pad.r + pad.l)/2);
    xLab.setAttribute('y', H - 4);
    xLab.setAttribute('text-anchor', 'middle');
    xLab.setAttribute('class', 'label');
    xLab.textContent = `Distance depuis la rive ${tr.rive_depart || ''} (m)`;
    svg.appendChild(xLab);

    // Polygone fermé entre profil et ligne d'eau (y=0)
    let pathSurface = '';
    pts.forEach((p, i) => {
      pathSurface += (i === 0 ? 'M' : 'L') + xScale(p.x) + ' ' + yScale(p.y);
    });
    const lastX = xScale(pts[pts.length-1].x), firstX = xScale(pts[0].x);
    pathSurface += ` L${lastX} ${ySurface} L${firstX} ${ySurface} Z`;

    // Remplissage marron pour la partie hors d'eau (au-dessus de la ligne d'eau)
    const surfAir = document.createElementNS(svgNS, 'path');
    surfAir.setAttribute('d', pathSurface);
    surfAir.setAttribute('class', 'surf-air');
    surfAir.setAttribute('clip-path', 'url(#clip-air)');
    svg.appendChild(surfAir);

    // Remplissage bleu pour la partie en eau (sous la ligne d'eau)
    const surfEau = document.createElementNS(svgNS, 'path');
    surfEau.setAttribute('d', pathSurface);
    surfEau.setAttribute('class', 'surf-eau');
    surfEau.setAttribute('clip-path', 'url(#clip-eau)');
    svg.appendChild(surfEau);

    // Ligne du profil
    const profile = document.createElementNS(svgNS, 'path');
    let pathLine = '';
    pts.forEach((p, i) => {
      pathLine += (i === 0 ? 'M' : 'L') + xScale(p.x) + ' ' + yScale(p.y);
    });
    profile.setAttribute('d', pathLine);
    profile.setAttribute('class', 'line-eau');
    svg.appendChild(profile);

    // Ligne d'eau (sans étiquette)
    const eau = document.createElementNS(svgNS, 'line');
    eau.setAttribute('x1', pad.l); eau.setAttribute('x2', W - pad.r);
    eau.setAttribute('y1', ySurface); eau.setAttribute('y2', ySurface);
    eau.setAttribute('class', 'line-eau-niveau');
    svg.appendChild(eau);

    // Points
    pts.forEach(p => {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', xScale(p.x));
      c.setAttribute('cy', yScale(p.y));
      c.setAttribute('r', 3);
      c.setAttribute('class', p.y >= 0 ? 'pt-air' : 'pt');
      svg.appendChild(c);
    });

    root.appendChild(svg);
  },

  // ============================================================
  //   EXPORT
  // ============================================================
  renderExport() {
    const op = this.state.op;
    document.getElementById('json-preview').textContent = JSON.stringify(op, null, 2);
  },

  bindExport() {
    document.getElementById('btn-export-json').addEventListener('click', () => {
      Exporter.toJSON(this.state.op);
    });
    document.getElementById('btn-export-xlsx').addEventListener('click', () => {
      Exporter.toXLSX(this.state.op);
    });
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
