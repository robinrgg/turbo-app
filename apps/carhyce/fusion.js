/* ============================================================
   Fusion de deux opérations CARHYCE (format pivot v1.0)
   ------------------------------------------------------------
   Logique pure, sans DOM ni IndexedDB : choix par onglet entier
   (station / granulométrie / pente / colmatage) et choix
   transect par transect (source A ou B, exclusive).
   ============================================================ */

const Fusion = {

  SECTIONS: [
    { key: 'station',       label: 'Station' },
    { key: 'granulometrie', label: 'Granulométrie' },
    { key: 'pente',         label: 'Pente' },
    { key: 'colmatage',     label: 'Colmatage' },
  ],

  _nonVide(v) { return v !== null && v !== undefined && v !== ''; },

  // Libellé court décrivant le remplissage d'un onglet (aide au choix).
  completude(op, key) {
    const s = (op && op[key]) || {};
    if (key === 'station') {
      const champs = ['code', 'libelle', 'cours_eau', 'date', 'operateurs', 'debit_m3s'];
      const n = champs.filter(c => this._nonVide(s[c])).length;
      const lpb = (s.lpb_ev_mesures || []).filter(x => this._nonVide(x)).length;
      return `${n}/${champs.length} champs clés · Lpb-ev ${lpb}/3`;
    }
    if (key === 'granulometrie') {
      const n = (s.mesures_mm || []).filter(x => x !== null && x !== '' && !isNaN(x)).length;
      return `${n}/100 mesures`;
    }
    if (key === 'pente') {
      const n = (s.troncons || []).length;
      return `${n} tronçon${n > 1 ? 's' : ''}`;
    }
    if (key === 'colmatage') {
      if (!s.actif) return 'désactivé';
      const bat = (s.radiers || []).flatMap(r => r.batonnets || []);
      const rel = bat.filter(b => this._nonVide(b.profondeur_oxy_cm)).length;
      return `${rel}/${bat.length} relevés`;
    }
    return '';
  },

  // Score de remplissage d'un onglet, pour pré-sélectionner le côté le plus complet.
  scoreSection(op, key) {
    const s = (op && op[key]) || {};
    if (key === 'station') {
      const champs = ['code', 'libelle', 'cours_eau', 'date', 'operateurs',
                       'debit_m3s', 'pente_calculee_pourmille', 'longueur_reelle_m'];
      let n = champs.filter(c => this._nonVide(s[c])).length;
      n += (s.lpb_ev_mesures || []).filter(x => this._nonVide(x)).length;
      n += (s.lm_ev_mesures || []).filter(x => this._nonVide(x)).length;
      return n;
    }
    if (key === 'granulometrie')
      return (s.mesures_mm || []).filter(x => x !== null && x !== '' && !isNaN(x)).length;
    if (key === 'pente') return (s.troncons || []).length;
    if (key === 'colmatage') {
      if (!s.actif) return 0;
      return (s.radiers || []).flatMap(r => r.batonnets || [])
        .filter(b => this._nonVide(b.profondeur_oxy_cm)).length;
    }
    return 0;
  },

  estSupprime(tr) {
    return !!(tr && tr.modification && tr.modification.type === 'Suppression');
  },

  // Mêmes critères de complétude que côté saisie (App.isTransectComplete).
  estComplet(tr) {
    if (!tr) return false;
    if (tr.lpb_m == null || tr.lm_m == null || tr.hpb_m == null) return false;
    if (!tr.points || tr.points.length < 8) return false;
    if (!tr.facies_affine) return false;
    if (!tr.berge_rg || !tr.berge_rd || !tr.berge_rg.materiaux || !tr.berge_rd.materiaux) return false;
    return true;
  },

  // Le transect porte-t-il des données exploitables (pour pré-cocher la source) ?
  aDesDonnees(tr) {
    if (!tr || this.estSupprime(tr)) return false;
    return (tr.points && tr.points.length > 0)
        || this._nonVide(tr.lpb_m)
        || this._nonVide(tr.facies_affine);
  },

  statutTransect(tr) {
    if (!tr) return { code: 'absent', label: 'absent' };
    if (this.estSupprime(tr)) return { code: 'supprime', label: 'supprimé' };
    if (!tr.actif) return { code: 'inactif', label: 'désactivé' };
    if (this.estComplet(tr)) return { code: 'complet', label: 'complet' };
    const np = (tr.points || []).length;
    if (np > 0 || this._nonVide(tr.lpb_m)) return { code: 'partiel', label: `partiel (${np} pts)` };
    return { code: 'vide', label: 'à saisir' };
  },

  trParNumero(op, n) {
    return (op.transects || []).find(t => t.numero === n) || null;
  },

  // Les deux opérations désignent-elles vraisemblablement la même station ?
  memeStation(a, b) {
    const sa = a.station || {}, sb = b.station || {};
    const norm = v => (v || '').toString().trim().toLowerCase()
      .replace(/\s*\(fusion\)\s*$/, '').replace(/\s*\(importée\)\s*$/, '');
    const codeA = norm(sa.code), codeB = norm(sb.code);
    if (codeA && codeB) return codeA === codeB;
    return norm(sa.libelle) === norm(sb.libelle);
  },

  _clone(o) { return JSON.parse(JSON.stringify(o)); },

  /**
   * Assemble une nouvelle opération à partir des choix.
   * @param choix { sections:{station:'A'|'B',...}, transects:{ [numero]:'A'|'B'|null } }
   * @param gabarit opération vierge (DB.newOperation()) pour les transects non choisis.
   */
  assembler(opA, opB, choix, gabarit) {
    const src = { A: opA, B: opB };
    const pick = k => src[choix.sections[k]] || opA;
    const now = new Date().toISOString();

    const stationSrc = pick('station');
    const station = this._clone(stationSrc.station);
    if (station.libelle && !/\(fusion\)/.test(station.libelle)) {
      station.libelle = station.libelle + ' (fusion)';
    }

    const merged = {
      id: 'op_' + Date.now() + '_fus_' + Math.random().toString(36).slice(2, 8),
      meta: {
        schema_version: '1.0',
        application: 'CARHYCE Saisie Terrain',
        created_at: now,
        fusion_de: [opA.id, opB.id],
      },
      station,
      granulometrie: this._clone(pick('granulometrie').granulometrie),
      pente:         this._clone(pick('pente').pente),
      colmatage:     this._clone(pick('colmatage').colmatage),
      transects: [],
    };

    for (let n = 1; n <= 18; n++) {
      const ch = choix.transects[n];
      const a = this.trParNumero(opA, n);
      const b = this.trParNumero(opB, n);
      let tr = null;
      if (ch === 'A') tr = a;
      else if (ch === 'B') tr = b;
      else {
        // Aucune source choisie. À ce stade le transect ne porte de données
        // d'aucun côté (sinon le verrou de l'UI interdit la génération). Si les
        // deux côtés l'écartent (désactivé ou supprimé), on conserve cet état
        // plutôt que de le réactiver via le gabarit ; sinon transect vierge.
        const aEcarte = a && (!a.actif || this.estSupprime(a));
        const bEcarte = b && (!b.actif || this.estSupprime(b));
        if ((a || b) && aEcarte && bEcarte) tr = a || b;
        else tr = this.trParNumero(gabarit, n);
      }
      if (!tr) tr = this.trParNumero(gabarit, n) || { numero: n };
      tr = this._clone(tr);
      tr.numero = n;
      merged.transects.push(tr);
    }

    return merged;
  },
};

window.Fusion = Fusion;
