/**
 * HARD BOUNDARY — DISPLAY ONLY
 * This script NEVER clicks, focuses, or programmatically activates Fold / Call /
 * Raise / Check / Bet / Sit-in / Sit-out / All-in or any other betting control.
 * It only reads card info (console + DOM) and paints a floating overlay.
 * Free-chip practice aid only. Not auto-play.
 *
 * Detection inspired by dawid-niedzwiecki/replaypoker-odds-calculator (console.info
 * "Hole cards" / "Community cards" JSON), plus a DOM fallback poller.
 *
 * Chrome MV3 content script — world: MAIN (page context), so console.info is hookable.
 */

(function () {
  'use strict';

    if (window.__RP_ODDS_LOADED__) return;
    window.__RP_ODDS_LOADED__ = true;

    // ─── Card / evaluator ───────────────────────────────────────────────
    const RANK_CHAR = '23456789TJQKA';
    const RANK_MAP = {
      '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
      T: 10, J: 11, Q: 12, K: 13, A: 14,
    };
    const SUITS = 'shdc';
    const FULL_DECK = [];
    for (let r = 0; r < RANK_CHAR.length; r++) {
      for (let s = 0; s < SUITS.length; s++) {
        FULL_DECK.push(RANK_CHAR[r] + SUITS[s]);
      }
    }

    function normalizeCard(code) {
      if (code == null) return null;
      const raw = String(code).trim();
      if (!raw || raw[0] === 'X' || raw[0] === 'x') return null;
      // Accept "As", "AS", "aS", "10s", "10S", "Td", maybe "A♠"
      let m = raw.match(/^([2-9]|10|[TtJjQqKkAa])\s*([shdcSHDC♠♥♦♣])/);
      if (!m) m = raw.match(/^([2-9TJQKA])([shdc])$/i);
      if (!m) return null;
      let rank = m[1].toUpperCase();
      if (rank === '10') rank = 'T';
      let suit = m[2].toLowerCase();
      const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
      if (suitMap[m[2]]) suit = suitMap[m[2]];
      if (!RANK_MAP[rank] || SUITS.indexOf(suit) < 0) return null;
      return rank + suit;
    }

    function parseCardObj(code) {
      const n = normalizeCard(code);
      if (!n) return null;
      return { rank: RANK_MAP[n[0]], suit: n[1], code: n };
    }

    function compareScores(a, b) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av !== bv) return av - bv;
      }
      return 0;
    }

    /** Best 5-card score from exactly 5 cards. Returns array comparable lexicographically. */
    function evaluate5(cards) {
      const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
      const suits = cards.map((c) => c.suit);
      const flush = suits.every((s) => s === suits[0]);

      const uniq = [];
      for (let i = 0; i < ranks.length; i++) {
        if (uniq[uniq.length - 1] !== ranks[i]) uniq.push(ranks[i]);
      }

      let straight = false;
      let straightHigh = 0;
      if (uniq.length === 5 && uniq[0] - uniq[4] === 4) {
        straight = true;
        straightHigh = uniq[0];
      } else if (
        uniq.length === 5 &&
        uniq[0] === 14 &&
        uniq[1] === 5 &&
        uniq[2] === 4 &&
        uniq[3] === 3 &&
        uniq[4] === 2
      ) {
        // Wheel A-5
        straight = true;
        straightHigh = 5;
      }

      const counts = {};
      for (let i = 0; i < ranks.length; i++) {
        counts[ranks[i]] = (counts[ranks[i]] || 0) + 1;
      }
      const groups = Object.keys(counts)
        .map((r) => [Number(r), counts[r]])
        .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

      if (straight && flush) return [8, straightHigh];
      if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
      if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
      if (flush) return [5, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]];
      if (straight) return [4, straightHigh];
      if (groups[0][1] === 3) {
        return [3, groups[0][0], groups[1][0], groups[2][0]];
      }
      if (groups[0][1] === 2 && groups[1][1] === 2) {
        const hi = Math.max(groups[0][0], groups[1][0]);
        const lo = Math.min(groups[0][0], groups[1][0]);
        return [2, hi, lo, groups[2][0]];
      }
      if (groups[0][1] === 2) {
        return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
      }
      return [0, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]];
    }

    const COMB5_IDX = (function () {
      const out = [];
      for (let a = 0; a < 7; a++)
        for (let b = a + 1; b < 7; b++)
          for (let c = b + 1; c < 7; c++)
            for (let d = c + 1; d < 7; d++)
              for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]);
      return out;
    })();

    function evaluate7(seven) {
      let best = null;
      const buf = new Array(5);
      for (let i = 0; i < COMB5_IDX.length; i++) {
        const ix = COMB5_IDX[i];
        buf[0] = seven[ix[0]];
        buf[1] = seven[ix[1]];
        buf[2] = seven[ix[2]];
        buf[3] = seven[ix[3]];
        buf[4] = seven[ix[4]];
        const sc = evaluate5(buf);
        if (!best || compareScores(sc, best) > 0) best = sc;
      }
      return best;
    }

    // Fisher–Yates using Math.random (fine for practice equity estimate)
    function shuffleInPlace(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }

    /**
     * Monte Carlo equity vs N random opponent hole cards.
     * Returns { win, tie, lose, trials } as percentages 0–100,
     * plus beatCats / beatPockets: P(at least one opp beats hero with that
     * made-hand category / pocket-pair rank) as 0–1 fractions (practice approx).
     */
    function monteCarlo(heroCodes, boardCodes, oppCount, trials) {
      const hero = heroCodes.map(parseCardObj).filter(Boolean);
      const board = boardCodes.map(parseCardObj).filter(Boolean);
      if (hero.length !== 2) return null;
      if (board.length > 5) return null;
      const nOpp = Math.max(1, Math.min(9, oppCount | 0));
      const nTrials = Math.max(500, Math.min(50000, trials | 0));

      const used = {};
      for (let i = 0; i < hero.length; i++) used[hero[i].code] = true;
      for (let i = 0; i < board.length; i++) used[board[i].code] = true;

      const remaining = [];
      for (let i = 0; i < FULL_DECK.length; i++) {
        if (!used[FULL_DECK[i]]) remaining.push(parseCardObj(FULL_DECK[i]));
      }

      const needBoard = 5 - board.length;
      const needOpp = nOpp * 2;
      if (remaining.length < needBoard + needOpp) return null;

      let wins = 0;
      let ties = 0;
      let losses = 0;
      const catHits = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const pocketHits = {};
      const pool = remaining.slice();

      for (let t = 0; t < nTrials; t++) {
        shuffleInPlace(pool);
        let p = 0;
        const fullBoard = board.slice();
        for (let i = 0; i < needBoard; i++) fullBoard.push(pool[p++]);

        const heroSeven = hero.concat(fullBoard);
        const heroScore = evaluate7(heroSeven);

        let beaten = false;
        let tied = false;
        // Fixed flags — avoid per-trial Object.keys alloc for beat-% tracking.
        let tc0 = 0, tc1 = 0, tc2 = 0, tc3 = 0, tc4 = 0, tc5 = 0, tc6 = 0, tc7 = 0, tc8 = 0;
        let pkMask = 0; // bit (rank-2) for pocket 2..A
        for (let o = 0; o < nOpp; o++) {
          const o1 = pool[p++];
          const o2 = pool[p++];
          const oppScore = evaluate7([o1, o2, fullBoard[0], fullBoard[1], fullBoard[2], fullBoard[3], fullBoard[4]]);
          const cmp = compareScores(oppScore, heroScore);
          if (cmp > 0) {
            beaten = true;
            const oc = oppScore[0] | 0;
            if (oc === 0) tc0 = 1;
            else if (oc === 1) tc1 = 1;
            else if (oc === 2) tc2 = 1;
            else if (oc === 3) tc3 = 1;
            else if (oc === 4) tc4 = 1;
            else if (oc === 5) tc5 = 1;
            else if (oc === 6) tc6 = 1;
            else if (oc === 7) tc7 = 1;
            else if (oc === 8) tc8 = 1;
            if (o1.rank === o2.rank) pkMask |= 1 << (o1.rank - 2);
          } else if (cmp === 0) {
            tied = true;
          }
        }
        if (beaten) {
          losses++;
          if (tc0) catHits[0]++;
          if (tc1) catHits[1]++;
          if (tc2) catHits[2]++;
          if (tc3) catHits[3]++;
          if (tc4) catHits[4]++;
          if (tc5) catHits[5]++;
          if (tc6) catHits[6]++;
          if (tc7) catHits[7]++;
          if (tc8) catHits[8]++;
          if (pkMask) {
            for (let r = 2; r <= 14; r++) {
              if (pkMask & (1 << (r - 2))) pocketHits[r] = (pocketHits[r] || 0) + 1;
            }
          }
        } else if (tied) ties++;
        else wins++;
      }

      const tot = wins + ties + losses;
      const beatCats = {};
      for (let c = 0; c <= 8; c++) {
        if (catHits[c]) beatCats[c] = catHits[c] / tot;
      }
      const beatPockets = {};
      const pks = Object.keys(pocketHits);
      for (let i = 0; i < pks.length; i++) {
        const r = Number(pks[i]);
        beatPockets[r] = pocketHits[r] / tot;
      }
      return {
        win: (100 * wins) / tot,
        tie: (100 * ties) / tot,
        lose: (100 * losses) / tot,
        trials: tot,
        beatCats: beatCats,
        beatPockets: beatPockets,
      };
    }


    function combosPick(n, k) {
      const out = [];
      const idx = [];
      for (let i = 0; i < k; i++) idx.push(i);
      while (true) {
        out.push(idx.slice());
        let i = k - 1;
        while (i >= 0 && idx[i] === n - k + i) i--;
        if (i < 0) break;
        idx[i]++;
        for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
      }
      return out;
    }

    const COMB42 = combosPick(4, 2);
    const COMB53 = combosPick(5, 3);

    /** Omaha Hi: exactly 2 hole + exactly 3 board. hole=4 cards, board=5. */
    function evaluateOmahaHi(hole, board5) {
      if (!hole || hole.length !== 4 || !board5 || board5.length !== 5) return null;
      let best = null;
      for (let a = 0; a < COMB42.length; a++) {
        const h0 = hole[COMB42[a][0]];
        const h1 = hole[COMB42[a][1]];
        for (let b = 0; b < COMB53.length; b++) {
          const five = [
            h0,
            h1,
            board5[COMB53[b][0]],
            board5[COMB53[b][1]],
            board5[COMB53[b][2]],
          ];
          const sc = evaluate5(five);
          if (!best || compareScores(sc, best) > 0) best = sc;
        }
      }
      return best;
    }

    /** Low rank: A=1, 2–8 as-is; 9+ cannot make Low. */
    function lowRankValue(card) {
      if (!card) return null;
      const r = card.rank | 0;
      if (r === 14) return 1;
      if (r >= 2 && r <= 8) return r;
      return null;
    }

    /** Board can produce an 8-or-better Low only with ≥3 distinct ranks ≤8. */
    function boardCanHaveLow(board5) {
      if (!board5 || board5.length !== 5) return false;
      const seen = {};
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const v = lowRankValue(board5[i]);
        if (v == null) continue;
        if (seen[v]) continue;
        seen[v] = true;
        n++;
      }
      return n >= 3;
    }

    /**
     * Best Omaha Low (8-or-better): exactly 2 hole + 3 board, 5 unique ranks ≤8.
     * Returns descending rank array (A=1), or null if unqualified.
     */
    function evaluateOmahaLow(hole, board5) {
      if (!hole || hole.length !== 4 || !board5 || board5.length !== 5) return null;
      let best = null;
      for (let a = 0; a < COMB42.length; a++) {
        const h0 = hole[COMB42[a][0]];
        const h1 = hole[COMB42[a][1]];
        const hv0 = lowRankValue(h0);
        const hv1 = lowRankValue(h1);
        if (hv0 == null || hv1 == null || hv0 === hv1) continue;
        for (let b = 0; b < COMB53.length; b++) {
          const v0 = lowRankValue(board5[COMB53[b][0]]);
          const v1 = lowRankValue(board5[COMB53[b][1]]);
          const v2 = lowRankValue(board5[COMB53[b][2]]);
          if (v0 == null || v1 == null || v2 == null) continue;
          const vals = [hv0, hv1, v0, v1, v2];
          const seen = {};
          let ok = true;
          for (let i = 0; i < 5; i++) {
            if (seen[vals[i]]) {
              ok = false;
              break;
            }
            seen[vals[i]] = true;
          }
          if (!ok) continue;
          vals.sort(function (x, y) {
            return y - x;
          });
          if (!best || compareLows(vals, best) > 0) best = vals;
        }
      }
      return best;
    }

    /** >0 if a is a better (lower) Low than b. */
    function compareLows(a, b) {
      for (let i = 0; i < 5; i++) {
        const d = (b[i] || 0) - (a[i] || 0);
        if (d) return d;
      }
      return 0;
    }

    function monteCarloOmaha(heroCodes, boardCodes, oppCount, trials, opts) {
      opts = opts || {};
      const wantLo = !!opts.hiLo;
      const hero = (heroCodes || []).map(parseCardObj).filter(Boolean);
      if (hero.length !== 4) return null;
      const board = (boardCodes || []).map(parseCardObj).filter(Boolean);
      if (board.length > 5) return null;
      const used = {};
      for (let i = 0; i < hero.length; i++) used[hero[i].code] = true;
      for (let i = 0; i < board.length; i++) used[board[i].code] = true;
      const deck = [];
      for (let i = 0; i < FULL_DECK.length; i++) {
        if (!used[FULL_DECK[i]]) deck.push(FULL_DECK[i]);
      }
      const nOpp = Math.max(1, Math.min(9, oppCount | 0));
      const needBoard = 5 - board.length;
      const needOpp = nOpp * 4;
      if (deck.length < needBoard + needOpp) return null;

      let wins = 0;
      let ties = 0;
      let losses = 0;
      let lowWins = 0;
      let lowTies = 0;
      let lowLosses = 0;
      let noLow = 0;
      let scoops = 0;
      const catHits = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const N = Math.max(200, trials | 0);
      for (let t = 0; t < N; t++) {
        for (let i = 0; i < needBoard + needOpp; i++) {
          const j = i + Math.floor(Math.random() * (deck.length - i));
          const tmp = deck[i];
          deck[i] = deck[j];
          deck[j] = tmp;
        }
        let p = 0;
        const fullBoard = board.slice();
        for (let i = 0; i < needBoard; i++) {
          fullBoard.push(parseCardObj(deck[p++]));
        }
        const heroScore = evaluateOmahaHi(hero, fullBoard);
        let beaten = false;
        let tied = false;
        let tc0 = 0, tc1 = 0, tc2 = 0, tc3 = 0, tc4 = 0, tc5 = 0, tc6 = 0, tc7 = 0, tc8 = 0;
        const oppHoles = [];
        for (let o = 0; o < nOpp; o++) {
          const oh = [
            parseCardObj(deck[p++]),
            parseCardObj(deck[p++]),
            parseCardObj(deck[p++]),
            parseCardObj(deck[p++]),
          ];
          oppHoles.push(oh);
          const oppScore = evaluateOmahaHi(oh, fullBoard);
          const cmp = compareScores(oppScore, heroScore);
          if (cmp > 0) {
            beaten = true;
            const oc = oppScore[0] | 0;
            if (oc === 0) tc0 = 1;
            else if (oc === 1) tc1 = 1;
            else if (oc === 2) tc2 = 1;
            else if (oc === 3) tc3 = 1;
            else if (oc === 4) tc4 = 1;
            else if (oc === 5) tc5 = 1;
            else if (oc === 6) tc6 = 1;
            else if (oc === 7) tc7 = 1;
            else if (oc === 8) tc8 = 1;
          } else if (cmp === 0) {
            tied = true;
          }
        }
        let hiWin = false;
        let hiTie = false;
        if (beaten) {
          losses++;
          if (tc0) catHits[0]++;
          if (tc1) catHits[1]++;
          if (tc2) catHits[2]++;
          if (tc3) catHits[3]++;
          if (tc4) catHits[4]++;
          if (tc5) catHits[5]++;
          if (tc6) catHits[6]++;
          if (tc7) catHits[7]++;
          if (tc8) catHits[8]++;
        } else if (tied) {
          ties++;
          hiTie = true;
        } else {
          wins++;
          hiWin = true;
        }

        if (wantLo) {
          let splitLow = false;
          let loWin = false;
          let loTie = false;
          if (!boardCanHaveLow(fullBoard)) {
            noLow++;
          } else {
            const heroLow = evaluateOmahaLow(hero, fullBoard);
            let bestOpp = null;
            let oppBestCount = 0;
            for (let o = 0; o < oppHoles.length; o++) {
              const ol = evaluateOmahaLow(oppHoles[o], fullBoard);
              if (!ol) continue;
              if (!bestOpp || compareLows(ol, bestOpp) > 0) {
                bestOpp = ol;
                oppBestCount = 1;
              } else if (compareLows(ol, bestOpp) === 0) {
                oppBestCount++;
              }
            }
            if (!heroLow && !bestOpp) {
              noLow++;
            } else if (!heroLow) {
              splitLow = true;
              lowLosses++;
            } else if (!bestOpp) {
              splitLow = true;
              lowWins++;
              loWin = true;
            } else {
              splitLow = true;
              const c = compareLows(heroLow, bestOpp);
              if (c > 0) {
                lowWins++;
                loWin = true;
              } else if (c === 0) {
                lowTies++;
                loTie = true;
              } else {
                lowLosses++;
              }
            }
          }
          // Scoop ≈ take whole pot: exclusive high win + (no low half or exclusive low win)
          if (hiWin && (!splitLow || loWin) && !loTie && !hiTie) {
            scoops++;
          }
        }
      }
      const tot = wins + ties + losses;
      const beatCats = {};
      for (let c = 0; c <= 8; c++) {
        if (catHits[c]) beatCats[c] = catHits[c] / tot;
      }
      const out = {
        win: (100 * wins) / tot,
        tie: (100 * ties) / tot,
        lose: (100 * losses) / tot,
        trials: tot,
        beatCats: beatCats,
        beatPockets: {},
      };
      if (wantLo) {
        out.lowWin = (100 * lowWins) / tot;
        out.lowTie = (100 * lowTies) / tot;
        out.lowLose = (100 * lowLosses) / tot;
        out.noLow = (100 * noLow) / tot;
        out.scoop = (100 * scoops) / tot;
        out.hiLo = true;
      }
      return out;
    }

    const HAND_NAME = [
      '高牌',
      '一对',
      '两对',
      '三条',
      '顺子',
      '同花',
      '葫芦',
      '四条',
      '同花顺',
    ];

    function handNameFromScore(sc) {
      if (!sc || sc[0] == null) return '—';
      return HAND_NAME[sc[0]] || '—';
    }

    function countSuits(cards) {
      const m = { s: 0, h: 0, d: 0, c: 0 };
      for (let i = 0; i < cards.length; i++) {
        if (cards[i] && m[cards[i].suit] != null) m[cards[i].suit]++;
      }
      return m;
    }

    function maxSuitCount(cards) {
      const m = countSuits(cards);
      return Math.max(m.s, m.h, m.d, m.c);
    }

    function uniqueRanksDesc(cards) {
      const seen = {};
      const out = [];
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].rank;
        if (!seen[r]) {
          seen[r] = true;
          out.push(r);
        }
      }
      out.sort(function (a, b) { return b - a; });
      return out;
    }

    function boardStraightThreat(ranks) {
      // ranks unique desc; check if any 5-window of consecutive ranks almost filled
      const set = {};
      for (let i = 0; i < ranks.length; i++) set[ranks[i]] = true;
      // wheel
      const wheel = [14, 5, 4, 3, 2];
      let wheelHit = 0;
      for (let i = 0; i < wheel.length; i++) if (set[wheel[i]]) wheelHit++;
      let best = wheelHit;
      for (let hi = 14; hi >= 5; hi--) {
        let hit = 0;
        for (let r = hi; r >= hi - 4; r--) if (set[r]) hit++;
        if (hit > best) best = hit;
      }
      return best; // 0-5 cards participating in a straight window
    }

    function heroUsesHole(hero, board, score) {
      // rough: compare board-only best vs hero+board best
      if (!score || board.length < 3) return true;
      if (board.length === 5) {
        const boardOnly = evaluate5(board);
        return compareScores(score, boardOnly) > 0;
      }
      if (board.length === 4) {
        // best 5 from board+one fictional won't work; just check if board 4 can make category
        return true;
      }
      return true;
    }

    function rankLabel(r) {
      const m = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
      return m[r] || String(r);
    }

    function boardPairInfo(board) {
      const rc = {};
      for (let i = 0; i < board.length; i++) {
        rc[board[i].rank] = (rc[board[i].rank] || 0) + 1;
      }
      let pairs = 0;
      let trips = false;
      let quads = false;
      const pairRanks = [];
      const keys = Object.keys(rc);
      for (let i = 0; i < keys.length; i++) {
        const r = Number(keys[i]);
        const n = rc[keys[i]];
        if (n >= 4) quads = true;
        else if (n >= 3) trips = true;
        else if (n >= 2) {
          pairs++;
          pairRanks.push(r);
        }
      }
      pairRanks.sort(function (a, b) { return b - a; });
      return { pairs: pairs, trips: trips, quads: quads, pairRanks: pairRanks, counts: rc };
    }

    /**
     * Which beater categories can still appear given board texture + street.
     * Practice-tip filter (not full combo enum). Texas Hold'em board len 3–5.
     */
    function boardBeatPossibilities(board) {
      const suitN = maxSuitCount(board);
      const ranks = uniqueRanksDesc(board);
      const straightHit = boardStraightThreat(ranks);
      const bp = boardPairInfo(board);
      const len = board.length;
      const river = len >= 5;
      const unpaired = !(bp.pairs || bp.trips || bp.quads);

      // Flush: 2 hole cards need board to already show ≥3 of a suit
      const flush = suitN >= 3;

      // Straight: river needs ≥3 ranks in some 5-window; turn ≥2; flop runners OK
      let straight = false;
      if (river) straight = straightHit >= 3;
      else if (len === 4) straight = straightHit >= 2;
      else straight = true;

      // Full house: river unpaired = impossible; flop/turn unpaired can still pair
      const fullHouse = river ? !unpaired : true;

      // Quads (practice): only when board already has pair/trips/quads
      // (omit rare unpaired flop/turn "both remaining of pocket rank" case)
      const quads = !!(bp.pairs || bp.trips || bp.quads);

      const straightFlush = flush && straight;

      return {
        flush: flush,
        straight: straight,
        fullHouse: fullHouse,
        quads: quads,
        straightFlush: straightFlush,
        suitN: suitN,
        straightHit: straightHit,
        bp: bp,
        unpaired: unpaired,
        river: river,
      };
    }

    /**
     * Can a villain make a strictly higher two-pair than hero with 2 hole cards
     * on this board (Hold'em; Omaha made hands also use exactly 2 holes)?
     * Street-aware: flop/turn also consider one future board card (new rank or pair).
     *
     * Kept when e.g. unpaired board still has a higher board-card pair combo, or a
     * paired board allows a higher pocket+board-pair / side-pair. Dropped when hero
     * already holds the nut two-pair for this texture (e.g. top two board cards).
     */
    function higherTwoPairPossible(hero, board, heroScore) {
      if (!heroScore || heroScore[0] !== 2) return true;
      if (!hero || !board || board.length < 3) return true;

      const heroHi = heroScore[1];
      const heroLo = heroScore[2];
      const bp = boardPairInfo(board);
      const ranks = uniqueRanksDesc(board);

      const used = {};
      for (let i = 0; i < board.length; i++) {
        const r = board[i].rank;
        used[r] = (used[r] || 0) + 1;
      }
      for (let i = 0; i < hero.length; i++) {
        const r = hero[i].rank;
        used[r] = (used[r] || 0) + 1;
      }
      function rem(r) {
        return 4 - (used[r] || 0);
      }
      function beatsHero(hi, lo) {
        return hi > heroHi || (hi === heroHi && lo > heroLo);
      }

      // Singles on board: villain pairs two of them with one hole each.
      const singles = [];
      for (let i = 0; i < ranks.length; i++) {
        const r = ranks[i];
        if ((bp.counts[r] || 0) === 1 && rem(r) >= 1) singles.push(r);
      }
      for (let i = 0; i < singles.length; i++) {
        for (let j = i + 1; j < singles.length; j++) {
          const hi = Math.max(singles[i], singles[j]);
          const lo = Math.min(singles[i], singles[j]);
          if (beatsHero(hi, lo)) return true;
        }
      }

      // Exactly one board pair: pocket pair P + board pair → two-pair.
      // (Board-pair + pair a side card is covered by the singles loop.)
      if (bp.pairs === 1 && !bp.trips && !bp.quads) {
        const boardPairRank = bp.pairRanks[0];
        for (let p = 2; p <= 14; p++) {
          if (p === boardPairRank) continue;
          if (rem(p) < 2) continue;
          const hi = Math.max(p, boardPairRank);
          const lo = Math.min(p, boardPairRank);
          if (beatsHero(hi, lo)) return true;
        }
      }

      // Flop/turn: one future board card may unlock a higher two-pair.
      if (board.length < 5) {
        // Fresh rank N lands; villain holds N + current single S → two-pair N+S.
        for (let n = 2; n <= 14; n++) {
          if ((bp.counts[n] || 0) > 0) continue;
          if (rem(n) < 2) continue;
          for (let si = 0; si < singles.length; si++) {
            const s = singles[si];
            if (rem(s) < 1) continue;
            const hi = Math.max(n, s);
            const lo = Math.min(n, s);
            if (beatsHero(hi, lo)) return true;
          }
        }
        // Board pairs an existing single S; villain pocket P → two-pair P+S.
        for (let si = 0; si < singles.length; si++) {
          const s = singles[si];
          if (rem(s) < 1) continue;
          for (let p = 2; p <= 14; p++) {
            if (p === s) continue;
            if (rem(p) < 2) continue;
            const hi = Math.max(p, s);
            const lo = Math.min(p, s);
            if (beatsHero(hi, lo)) return true;
          }
        }
      }

      return false;
    }

    /** Drop beat labels that contradict boardBeatPossibilities (+ hero-aware two-pair). */
    function beatLabelPossible(label, poss) {
      if (!label || !poss) return true;
      // Check longer / more specific names first
      if (label.indexOf('同花顺') >= 0) return !!poss.straightFlush;
      if (label.indexOf('更大两对') >= 0) return !!poss.higherTwoPair;
      if (label.indexOf('同花') >= 0) return !!poss.flush;
      if (label.indexOf('葫芦') >= 0) return !!poss.fullHouse;
      if (label.indexOf('四条') >= 0) return !!poss.quads;
      // 顺子 / 更大顺 (not 同花顺 — already handled)
      if (label.indexOf('顺') >= 0) return !!poss.straight;
      return true;
    }

    function filterBeatsByBoard(beats, poss) {
      if (!beats || !beats.length) return null;
      const out = [];
      for (let i = 0; i < beats.length; i++) {
        if (beatLabelPossible(beats[i], poss)) out.push(beats[i]);
      }
      return out.length ? out : null;
    }

    /**
     * After removing hero cards from consideration: which hand classes can still beat hero.
     * Practice tips only — not a full combo enumeration.
     * beats[] are filtered to categories that can ACTUALLY appear on this board/street.
     */
    function handsThatBeatYou(hero, board, heroScore) {
      const tips = [];
      if (!hero || (hero.length !== 2 && hero.length !== 4) || !board || board.length < 3 || !heroScore) {
        return tips;
      }
      const cat = heroScore[0];
      const poss = boardBeatPossibilities(board);
      // 更大两对 only when villain can actually make a higher two-pair with 2 holes.
      poss.higherTwoPair = higherTwoPairPossible(hero, board, heroScore);
      const suitN = poss.suitN;
      const ranks = uniqueRanksDesc(board);
      const straightHit = poss.straightHit;
      const bp = poss.bp;
      const boardHigh = ranks.length ? ranks[0] : 0;

      function push(level, text, beats) {
        const filtered = filterBeatsByBoard(beats, poss);
        tips.push({ level: level, text: text, kind: 'beat', beats: filtered });
      }

      // Flush threats (opponent can hold flush if board has 3+ of a suit)
      if (poss.flush && cat < 5) {
        push(
          suitN >= 4 ? 'danger' : 'warn',
          suitN >= 5
            ? '牌面同花已成'
            : suitN === 4
              ? '再一张同花色就成同花'
              : '两张同花色可成同花',
          ['同花', '同花顺']
        );
      } else if (poss.flush && cat === 5) {
        // Hero has flush — higher flush possible unless nut
        const flushSuit = (function () {
          const m = countSuits(board);
          let best = 's';
          let n = -1;
          const ks = ['s', 'h', 'd', 'c'];
          for (let i = 0; i < ks.length; i++) {
            if (m[ks[i]] > n) {
              n = m[ks[i]];
              best = ks[i];
            }
          }
          return best;
        })();
        const heroFlushRanks = [];
        for (let i = 0; i < hero.length; i++) {
          if (hero[i].suit === flushSuit) heroFlushRanks.push(hero[i].rank);
        }
        for (let i = 0; i < board.length; i++) {
          if (board[i].suit === flushSuit) heroFlushRanks.push(board[i].rank);
        }
        heroFlushRanks.sort(function (a, b) { return b - a; });
        const nutish = heroFlushRanks[0] === 14;
        if (!nutish) {
          push('danger', '你非坚果同花', ['更大同花', '同花顺']);
        } else {
          push('warn', '坚果同花仍要防', ['同花顺', '葫芦']);
        }
      }

      // Straight threats
      if (poss.straight && straightHit >= 4 && cat < 4) {
        push(
          straightHit >= 5 ? 'danger' : 'warn',
          straightHit >= 5 ? '牌面顺子窗口已满' : '顺子听牌一旦成牌',
          ['顺子', '同花', '葫芦']
        );
      } else if (poss.straight && straightHit >= 4 && cat === 4) {
        push('warn', '你是顺子但不是无敌', ['更大顺', '同花', '葫芦', '四条']);
      }

      // Full house / quads when board paired
      if (bp.trips || bp.quads) {
        push('danger', '牌面三条/四条', ['葫芦', '四条']);
      } else if (bp.pairs >= 1 && cat < 6) {
        if (cat >= 4) {
          push('warn', '牌面有对，顺/同花不无敌', ['葫芦', '四条']);
        } else if (cat === 2) {
          push('warn', '牌面配对后葫芦更常见', ['更大两对', '三条', '葫芦']);
        } else {
          push('info', '牌面有对', ['葫芦']);
        }
      }

      // Category-specific defaults (beats filtered by board possibilities)
      if (cat <= 0) {
        push('warn', '你还是高牌', ['一对', '两对', '三条', '顺子', '同花']);
      } else if (cat === 1) {
        const pairR = heroScore[1];
        const over = [];
        for (let r = pairR + 1; r <= 14; r++) {
          if (!(bp.counts[r] >= 2)) over.push(rankLabel(r));
        }
        if (pairR < boardHigh) {
          push('danger', '弱对', ['更大对', '两对', '三条', '顺子', '同花']);
        } else if (pairR === boardHigh) {
          push('warn', '顶对', ['两对', '暗三', '顺子', '同花', '葫芦']);
        } else {
          push('warn', '超对', ['顶两对', '暗三', '顺子', '同花', '葫芦']);
        }
        if (over.length && pairR < 14) {
          const few = [];
          for (let r = 14; r > pairR && few.length < 4; r--) {
            if (!(bp.counts[r] >= 2)) few.push(rankLabel(r));
          }
          if (few.length) {
            const pocketChip = formatPocketRangeChip(few);
            push('info', '更大口袋对：' + few.join('/'), [pocketChip]);
          }
        }
      } else if (cat === 2) {
        push('warn', '两对', ['更大两对', '三条', '顺子', '同花', '葫芦']);
      } else if (cat === 3) {
        push('warn', '三条', ['更大暗三', '顺子', '同花', '葫芦', '四条']);
      } else if (cat === 4) {
        push('warn', '顺子', ['更大顺', '同花', '葫芦', '四条', '同花顺']);
      } else if (cat === 5) {
        push('info', '同花', ['更大同花', '葫芦', '四条', '同花顺']);
      } else if (cat === 6) {
        push('info', '葫芦', ['更大葫芦', '四条', '同花顺']);
      } else if (cat === 7) {
        push('info', '四条', ['更大四条', '同花顺']);
      } else if (cat === 8) {
        push('info', '同花顺', ['更大同花顺']);
      }

      return tips;
    }

    /**
     * Situation notes for practice: made hand + board dangers + draws.
     * Returns { made, alerts:[{level:'danger'|'warn'|'info', text}] }
     */

    /**
     * Omaha own draws: only 2 hole cards count toward a flush/straight.
     * Flush draw = ≥2 hole of suit S + exactly 2 board of S (need one more).
     * 3 suited holes + 1 board is NOT a flush draw (you may use only 2 holes).
     */
    function omahaOwnDraws(hero, board, cat) {
      const out = [];
      if (!hero || hero.length !== 4 || !board || board.length < 3 || board.length > 4) {
        return out;
      }
      const suits = ['s', 'h', 'd', 'c'];
      let flushDraw = false;
      for (let s = 0; s < suits.length; s++) {
        const suit = suits[s];
        let h = 0;
        let b = 0;
        for (let i = 0; i < hero.length; i++) if (hero[i].suit === suit) h++;
        for (let i = 0; i < board.length; i++) if (board[i].suit === suit) b++;
        if (h >= 2 && b >= 3) {
          // already a made flush possible — not a "draw"
          continue;
        }
        if (h >= 2 && b === 2 && cat < 5) flushDraw = true;
      }
      if (flushDraw) {
        out.push({ level: 'info', text: '你有同花听牌（需再用 2 手牌）' });
      }

      if (cat < 4) {
        let straightDraw = false;
        for (let a = 0; a < COMB42.length; a++) {
          const h0 = hero[COMB42[a][0]];
          const h1 = hero[COMB42[a][1]];
          const ranks = uniqueRanksDesc([h0, h1].concat(board));
          if (boardStraightThreat(ranks) >= 4) {
            straightDraw = true;
            break;
          }
        }
        if (straightDraw) {
          out.push({ level: 'info', text: '你有顺子听牌（需再用 2 手牌）' });
        }
      }
      return out;
    }

    function analyzeSituation(heroCodes, boardCodes) {
      const alerts = [];
      const hero = (heroCodes || []).map(parseCardObj).filter(Boolean);
      const board = (boardCodes || []).map(parseCardObj).filter(Boolean);
      if (hero.length !== 2 && hero.length !== 4) {
        return { made: '—', alerts: alerts };
      }
      const omahaHero = hero.length === 4;

      let made = '—';
      let heroScore = null;
      if (board.length >= 3) {
        if (omahaHero) {
          // Pad board to 5 with dummy only for label when <5 — skip until river-ready
          if (board.length === 5) {
            heroScore = evaluateOmahaHi(hero, board);
          } else {
            // Partial board: best Omaha hi among available board triples if board>=3
            // Use known board cards only: choose 3 from board when board has 3–4
            let best = null;
            const b = board;
            if (b.length === 3) {
              for (let a = 0; a < COMB42.length; a++) {
                const five = [
                  hero[COMB42[a][0]],
                  hero[COMB42[a][1]],
                  b[0],
                  b[1],
                  b[2],
                ];
                const sc = evaluate5(five);
                if (!best || compareScores(sc, best) > 0) best = sc;
              }
            } else if (b.length === 4) {
              const triples = combosPick(4, 3);
              for (let a = 0; a < COMB42.length; a++) {
                for (let t = 0; t < triples.length; t++) {
                  const five = [
                    hero[COMB42[a][0]],
                    hero[COMB42[a][1]],
                    b[triples[t][0]],
                    b[triples[t][1]],
                    b[triples[t][2]],
                  ];
                  const sc = evaluate5(five);
                  if (!best || compareScores(sc, best) > 0) best = sc;
                }
              }
            }
            heroScore = best;
          }
          made = (omahaHero ? 'Omaha ' : '') + handNameFromScore(heroScore);
        } else {
        const seven = hero.concat(board);
        // pad evaluate7 needs up to 7; evaluate with available by using evaluate7 only when 7
        if (seven.length === 7) {
          heroScore = evaluate7(seven);
        } else if (seven.length === 6) {
          // best 5 of 6
          let best = null;
          for (let skip = 0; skip < 6; skip++) {
            const buf = [];
            for (let i = 0; i < 6; i++) if (i !== skip) buf.push(seven[i]);
            const sc = evaluate5(buf);
            if (!best || compareScores(sc, best) > 0) best = sc;
          }
          heroScore = best;
        } else if (seven.length === 5) {
          heroScore = evaluate5(seven);
        } else {
          heroScore = null;
        }
        made = handNameFromScore(heroScore);
        } // end holdem scoring
      } else {
        // preflop: label + straight-window reminders (e.g. 4-7)
        if (omahaHero) {
          made = 'Omaha 起手';
          alerts.push({
            level: 'info',
            text: 'Omaha：必须用且只用 2 张手牌 + 3 张公共牌',
          });
          // fall through with limited pair/gap tips on first two ranks
        }
        const r0 = hero[0].rank;
        const r1 = hero[1].rank;
        const hi = Math.max(r0, r1);
        const lo = Math.min(r0, r1);
        const suited = hero[0].suit === hero[1].suit;
        const gap = hi === lo ? -1 : hi - lo - 1;
        if (r0 === r1) {
          made = '口袋对';
        } else if (gap === 0) {
          made = suited ? '同花连张' : '连张';
        } else if (gap === 1) {
          made = suited ? '同花单缺' : '单缺连张';
        } else if (gap === 2) {
          made = suited ? '同花双缺' : '双缺连张';
        } else if (suited) {
          made = '同花起手';
        } else {
          made = '高牌起手';
        }

        if (r0 !== r1) {
          if (gap === 0) {
            alerts.push({
              level: 'info',
              text: '连张：翻牌易出两头顺听牌，别只看高牌',
            });
          } else if (gap === 1) {
            alerts.push({
              level: 'warn',
              text: '单缺连张：顺子面不少，留意顺子可能',
            });
          } else if (gap === 2) {
            alerts.push({
              level: 'warn',
              text: '双缺（如4-7）：顺子概率常被忽略，翻牌盯顺子窗口',
            });
          } else if (gap === 3) {
            alerts.push({
              level: 'info',
              text: '间隔较大仍可能成顺，翻牌留意顺子窗口',
            });
          }
          // Wheel / broadway helpers
          if (hi === 14 && lo >= 2 && lo <= 5) {
            alerts.push({
              level: 'info',
              text: 'A + 低牌：注意轮子顺（A2345）可能',
            });
          } else if (hi <= 5 && lo >= 2 && gap <= 3) {
            alerts.push({
              level: 'info',
              text: '低牌区：轮子/小顺可能性',
            });
          } else if (hi === 14 && lo >= 10) {
            alerts.push({
              level: 'info',
              text: '高牌连区：百老汇顺子面',
            });
          }
        }
      }

      if (board.length >= 3 && heroScore) {
        const cat = heroScore[0];
        const beat = handsThatBeatYou(hero, board, heroScore);
        for (let i = 0; i < beat.length; i++) alerts.push(beat[i]);

        // Enrich made label: 顶对/超对/中对 etc.
        if (cat === 1) {
          const pairR = heroScore[1];
          const boardHigh = uniqueRanksDesc(board)[0];
          if (pairR > boardHigh) made = '超对' + rankLabel(pairR);
          else if (pairR === boardHigh) made = '顶对' + rankLabel(pairR);
          else {
            const br = uniqueRanksDesc(board);
            if (br.length > 1 && pairR === br[1]) made = '中对' + rankLabel(pairR);
            else made = '弱对' + rankLabel(pairR);
          }
        } else if (cat === 2) {
          made = '两对' + rankLabel(heroScore[1]) + '+' + rankLabel(heroScore[2]);
        } else if (cat === 3) {
          made = '三条' + rankLabel(heroScore[1]);
        } else if (cat >= 4) {
          made = handNameFromScore(heroScore);
        }

        alerts.unshift({
          level: 'info',
          text: '你现在：' + made,
        });

        // Own draws — Hold'em vs Omaha rules differ (Omaha: exactly 2 hole + 3 board)
        if (board.length <= 4) {
          if (omahaHero) {
            const draws = omahaOwnDraws(hero, board, cat);
            for (let di = 0; di < draws.length; di++) alerts.push(draws[di]);
          } else {
            const suitN = maxSuitCount(board);
            const all = hero.concat(board);
            const hs = maxSuitCount(all);
            if (hs >= 4 && suitN < 5 && cat < 5) {
              alerts.push({ level: 'info', text: '你有同花听牌' });
            }
            const allRanks = uniqueRanksDesc(all);
            const hit = boardStraightThreat(allRanks);
            if (hit === 4 && cat < 4) {
              alerts.push({ level: 'info', text: '你有顺子听牌' });
            }
          }
        }
      }

      // Deduplicate similar texts
      const seen = {};
      const uniq = [];
      for (let i = 0; i < alerts.length; i++) {
        const k = alerts[i].level + '|' + alerts[i].text;
        if (seen[k]) continue;
        seen[k] = true;
        uniq.push(alerts[i]);
      }
      // Beat-you tips first, then others; keep more room for beat chips
      const beats = [];
      const rest = [];
      for (let i = 0; i < uniq.length; i++) {
        if (uniq[i].kind === 'beat') beats.push(uniq[i]);
        else rest.push(uniq[i]);
      }
      const ordered = beats.concat(rest);
      return { made: made, alerts: ordered.slice(0, 10) };
    }

    function parseChipText(raw) {
      if (raw == null) return null;
      let s = String(raw).replace(/,/g, '').replace(/\s+/g, ' ').trim();
      if (!s) return null;
      // $1,234 / 1234 / 1.2k / 3.5M
      let m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*([kKmMbB])\b/);
      if (m) {
        let n = parseFloat(m[1]);
        const u = m[2].toUpperCase();
        if (u === 'K') n *= 1e3;
        else if (u === 'M') n *= 1e6;
        else if (u === 'B') n *= 1e9;
        return n;
      }
      m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
      return m ? parseFloat(m[1]) : null;
    }

    function scrapePotDom() {
      const sels = [
        '[class*="Pot"]',
        '[class*="pot"]',
        '[data-testid*="pot" i]',
        '[aria-label*="pot" i]',
        '[aria-label*="Pot"]',
      ];
      let best = null;
      for (let s = 0; s < sels.length; s++) {
        let nodes;
        try {
          nodes = document.querySelectorAll(sels[s]);
        } catch (_) {
          continue;
        }
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          const blob = (
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.textContent || '')
          ).slice(0, 120);
          if (!/pot|底池|Pot/i.test(blob) && sels[s].indexOf('Pot') < 0 && sels[s].indexOf('pot') < 0) {
            // still try numeric near pot-looking class
          }
          const n = parseChipText(blob);
          if (n != null && n > 0 && (best == null || n > best)) best = n;
        }
      }
      // Fallback: look for text "Pot:" patterns in game root
      try {
        const root =
          document.querySelector('.Game--holdem, [class*="Game"]') || document.body;
        const t = (root && root.innerText) || '';
        const m = t.match(/Pot\s*[:：]?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?\s*[kKmM]?)/i);
        if (m) {
          const n = parseChipText(m[1]);
          if (n != null && n > 0) best = n;
        }
      } catch (_) {}
      return best;
    }

    /**
     * Amount still needed to call (B). Read-only from action buttons.
     * Returns null when unknown / Check (no call) / not hero's turn.
     */
    function scrapeCallDom() {
      const sels = [
        '.Footer__actions .BettingControls__action--neutral',
        '.Footer__actions button.BettingControls__action--neutral',
        'button.BettingControls__action--neutral',
        '[class*="BettingControls__action--neutral"]',
        '.Footer__actions .PreTurnIntents__column--neutral',
        '[class*="PreTurnIntents__column--neutral"]',
      ];
      function parseCallBlob(blob) {
        if (!blob) return null;
        const s = String(blob).replace(/\s+/g, ' ').trim();
        if (!s) return null;
        // Pure check → no call required (hide tip)
        if (/^(Check|过牌)\b/i.test(s) && !/(Call|跟注|Raise|加注|Bet|下注|All-?In)/i.test(s)) {
          return 0;
        }
        let m = s.match(
          /(?:Call|跟注)\s*(?:All-?In)?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?\s*[kKmMbB]?)/i
        );
        if (m) return parseChipText(m[1]);
        // "All-in 123" on neutral when calling all-in
        m = s.match(/All-?In\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?\s*[kKmMbB]?)/i);
        if (m && /(Call|跟注|All-?In)/i.test(s) && !/(Raise|加注|Bet\b|下注)/i.test(s)) {
          return parseChipText(m[1]);
        }
        return null;
      }
      for (let s = 0; s < sels.length; s++) {
        let nodes;
        try {
          nodes = document.querySelectorAll(sels[s]);
        } catch (_) {
          continue;
        }
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          try {
            const st = window.getComputedStyle(el);
            if (st && (st.display === 'none' || st.visibility === 'hidden')) continue;
          } catch (_) {}
          const blob =
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.textContent || '');
          const n = parseCallBlob(blob);
          if (n != null && n > 0) return n;
          if (n === 0) return null; // Check → hide
        }
      }
      // Fallback: any footer/control button labeled Call/跟注 + amount
      try {
        const root =
          document.querySelector('.Footer__actions, [class*="BettingControls"], [class*="Footer"]') ||
          document.body;
        const btns = root.querySelectorAll('button, [role="button"], [class*="action"]');
        for (let i = 0; i < btns.length; i++) {
          const el = btns[i];
          const blob =
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.textContent || '');
          if (!/(Call|跟注)/i.test(blob)) continue;
          if (/(Raise|加注)/i.test(blob) && !/(Call|跟注)/i.test(blob)) continue;
          const n = parseCallBlob(blob);
          if (n != null && n > 0) return n;
        }
      } catch (_) {}
      return null;
    }

    /**
     * Pot-odds tip: need ≥ B/(P+B) equity to break even on a call.
     * Returns null when pot or call unknown (or call is 0).
     */
    function potOddsTip(pot, callAmt, eq) {
      if (pot == null || !(pot > 0)) return null;
      if (callAmt == null || !(callAmt > 0)) return null;
      const need = callAmt / (pot + callAmt);
      if (!(need > 0) || need > 1 || isNaN(need)) return null;
      const needPct = Math.round(need * 1000) / 10; // one decimal when helpful
      const needTxt =
        needPct >= 10 || Math.abs(needPct - Math.round(needPct)) < 0.05
          ? String(Math.round(needPct))
          : needPct.toFixed(1);
      let line = '跟注需≥' + needTxt + '%';
      let ok = null;
      if (eq != null && !isNaN(eq)) {
        // eq is already 0–100 (same as state.win from monteCarlo)
        const eqPct = Math.round(eq);
        ok = eq / 100 + 1e-9 >= need;
        line += ' · 现' + eqPct + '%' + (ok ? ' ✓' : ' 不足');
      }
      return {
        need: need,
        eq: eq,
        ok: ok,
        pot: pot,
        call: callAmt,
        label: line,
        detail:
          '底池' +
          Math.round(pot) +
          ' · 跟注' +
          Math.round(callAmt) +
          ' · 盈亏平衡 ' +
          needTxt +
          '%（B/(P+B)）',
      };
    }

    function streetName(boardLen) {
      if (boardLen <= 0) return '翻前';
      if (boardLen === 3) return '翻牌';
      if (boardLen === 4) return '转牌';
      if (boardLen >= 5) return '河牌';
      return '未知';
    }

    /**
     * Practice-only sizing hint from equity + board risk.
     * Returns { label, detail, potFrac, amount, pot }
     */
    function recommendBet(eq, boardLen, alerts, pot) {
      if (eq == null || isNaN(eq)) {
        return {
          label: '—',
          detail: '等权益算出后再给建议',
          potFrac: null,
          amount: null,
          pot: pot,
        };
      }
      const danger = (alerts || []).some(function (a) {
        return a.level === 'danger';
      });
      const warn = (alerts || []).some(function (a) {
        return a.level === 'warn';
      });
      const street = streetName(boardLen);

      let action = '过牌';
      let frac = 0;
      let why = '';

      if (eq >= 72) {
        action = danger ? '中下注' : '大下注';
        frac = danger ? 0.5 : boardLen >= 5 ? 0.75 : 0.66;
        why = danger
          ? '权益很高，但牌面有更大牌威胁，用中等尺度价值'
          : '权益很高，可按价值下注';
      } else if (eq >= 58) {
        action = danger ? '小下注/过牌' : '中下注';
        frac = danger ? 0.33 : 0.55;
        why = danger
          ? '权益不错但危险面，缩小尺度或过牌诱导'
          : '偏强，可用约半池施压';
      } else if (eq >= 48) {
        action = warn || danger ? '过牌' : '小下注';
        frac = warn || danger ? 0 : 0.33;
        why =
          warn || danger
            ? '中等权益且牌面危险，优先过牌控制'
            : '边缘优势，可用约 1/3 底池薄价值/阻挡';
      } else if (eq >= 38) {
        action = '过牌';
        frac = 0;
        why = '权益一般，建议过牌；面对大注多考虑弃牌';
      } else {
        action = '过牌/弃牌';
        frac = 0;
        why = '权益偏低，不要主动下注；被下注时倾向弃牌';
      }

      // Preflop: speak in BB-ish terms without pot
      if (boardLen < 3) {
        if (eq >= 60) {
          action = '加注';
          frac = null;
          why = '翻前偏强：建议加注（约 2.5–3x）';
        } else if (eq >= 45) {
          action = '可玩/加注';
          frac = null;
          why = '翻前中等：位置好可加注，否则跟注或弃牌看牌面';
        } else {
          action = '弃牌/冷跟谨慎';
          frac = null;
          why = '翻前偏弱：无位置别硬玩';
        }
      }

      let amount = null;
      let label = action;
      if (frac != null && frac > 0 && pot != null && pot > 0) {
        amount = Math.round(pot * frac);
        const pct = Math.round(frac * 100);
        label = action + ' · ~' + pct + '% 底池 ≈ ' + amount;
      } else if (frac != null && frac > 0) {
        const pct = Math.round(frac * 100);
        label = action + ' · ~' + pct + '% 底池';
      } else if (frac === 0) {
        label = action;
      }

      return {
        label: label,
        detail: street + ' · ' + why + '（仅练习参考，非必须照做）',
        potFrac: frac,
        amount: amount,
        pot: pot,
      };
    }

    // Expose tiny self-test helper (optional, console)
    window.__RP_ODDS_EVAL__ = {
      evaluate5,
      evaluate7,
      monteCarlo,
      monteCarloOmaha,
      evaluateOmahaHi,
      evaluateOmahaLow,
      boardCanHaveLow,
      detectGameVariant,
      normalizeCard,
      parseCardObj,
      analyzeSituation,
      handsThatBeatYou,
      boardBeatPossibilities,
      filterBeatsByBoard,
      higherTwoPairPossible,
      formatPocketRangeChip,
      mergeConsecutivePocketChips,
      beatLabelKey,
      lookupBeatPct,
      estimateOpponentsDom,
      syncOpponentsFromDom,
      scrapePotDom,
      scrapeCallDom,
      potOddsTip,
      recommendBet,
    };

    // ─── Game state ─────────────────────────────────────────────────────
    const state = {
      hero: [],
      board: [],
      variant: 'holdem',
      opponents: 0,
      hiLo: false,
      lowWin: null,
      lowTie: null,
      lowLose: null,
      noLow: null,
      scoop: null,
      source: '—',
      status: '等待发牌…',
      win: null,
      tie: null,
      lose: null,
      trials: 0,
      lastUpdate: null,
      computing: false,
      oppManualThisHand: false,
      made: '—',
      alerts: [],
      beatProbs: null,
      pot: null,
      callAmount: null,
      potOddsHint: null,
      betHint: null,
    };

    let computeToken = 0;
    // Fewer trials = less main-thread stall; ~4k is enough for HUD-grade equity/beat %.
    const DEFAULT_TRIALS = 4000;
    const OMAHA_TRIALS = 1200;
    const DOM_POLL_MS = 2500;
    const DOM_MUTATION_DEBOUNCE_MS = 400;
    const COMPUTE_DEBOUNCE_MS = 350;
    const OBSERVER_REBIND_MS = 4000;
    let lastDomHeroKey = '';
    let lastDomBoardKey = '';
    let domMissLogged = false;
    let lastNullRetryKey = '';
    let domObserver = null;
    let observedRoot = null;
    let pollDomSoonTimer = 0;
    let computeDebounceTimer = 0;
    let pendingComputeReason = '';
    let pendingComputeWhileHidden = false;
    let lastComputeKey = '';

    function isTabHidden() {
      try {
        return typeof document !== 'undefined' && !!document.hidden;
      } catch (_) {
        return false;
      }
    }

    function cardsKey(arr) {
      return (arr || []).join(',');
    }

    function refreshAnalysis() {
      const a = analyzeSituation(state.hero, state.board);
      state.made = a.made;
      state.alerts = a.alerts || [];
      // Mirror two-pair possibility onto beatProbs so chip % cannot go ghost-nonzero.
      try {
        const hFlag = (function () {
          if (!state.hero || state.hero.length < 2 || !state.board || state.board.length < 3) return true;
          const h = state.hero.map(parseCardObj).filter(Boolean);
          const b = state.board.map(parseCardObj).filter(Boolean);
          if (h.length < 2 || b.length < 3) return true;
          let hs = null;
          if (h.length === 4) {
            if (b.length === 5) hs = evaluateOmahaHi(h, b);
          } else if (b.length === 5) {
            hs = evaluate7(h.concat(b));
          } else if (b.length === 4) {
            const six = h.concat(b);
            let best = null;
            for (let skip = 0; skip < 6; skip++) {
              const buf = [];
              for (let i = 0; i < 6; i++) if (i !== skip) buf.push(six[i]);
              const sc = evaluate5(buf);
              if (!best || compareScores(sc, best) > 0) best = sc;
            }
            hs = best;
          } else if (b.length === 3) {
            hs = evaluate5(h.concat(b));
          }
          if (!hs || hs[0] !== 2) return true;
          return higherTwoPairPossible(h, b, hs);
        })();
        if (state.beatProbs) state.beatProbs.higherTwoPair = hFlag;
        else state._higherTwoPair = hFlag;
      } catch (_) {}
      try {
        const pot = scrapePotDom();
        if (pot != null) state.pot = pot;
      } catch (_) {}
      try {
        const callAmt = scrapeCallDom();
        state.callAmount = callAmt;
      } catch (_) {
        state.callAmount = null;
      }
      let eq = null;
      if (state.win != null && !isNaN(state.win)) {
        const tie = state.tie == null || isNaN(state.tie) ? 0 : state.tie;
        eq = state.win + tie;
      }
      try {
        state.potOddsHint = potOddsTip(state.pot, state.callAmount, eq);
      } catch (_) {
        state.potOddsHint = null;
      }
      state.betHint = recommendBet(
        eq,
        (state.board && state.board.length) || 0,
        state.alerts,
        state.pot
      );
    }

    function computeSignature() {
      return (
        cardsKey(state.hero) +
        '|' +
        cardsKey(state.board) +
        '|' +
        state.opponents +
        '|' +
        state.variant
      );
    }

    function runComputeNow(reason) {
      try {
        state.variant = detectGameVariant();
      } catch (_) {}
      refreshAnalysis();
      const omaha = isOmahaVariant(state.variant);
      const need = omaha ? 4 : 2;
      if (state.hero.length !== need) {
        state.win = state.tie = state.lose = null;
        state.lowWin = state.lowTie = state.lowLose = null;
        state.noLow = state.scoop = null;
        state.hiLo = false;
        state.beatProbs = null;
        lastComputeKey = '';
        if (omaha && state.hero.length > 0 && state.hero.length < 4) {
          state.status = 'Omaha 需要 4 张手牌（' + state.hero.length + '/4）';
        } else {
          state.status = state.hero.length ? '手牌不完整' : '等待手牌…';
        }
        render();
        return;
      }
      // Never leave equity blank solely because opp lock is still 0 — fill from DOM or 1.
      if (state.opponents < 1) {
        try {
          syncOpponentsFromDom({ force: true });
        } catch (_) {}
        if (state.opponents < 1) state.opponents = 1;
      }
      const sig = computeSignature();
      // Skip duplicate heavy MC when cards/opps unchanged (DOM twitch / rebind).
      if (
        sig === lastComputeKey &&
        state.win != null &&
        !isNaN(state.win) &&
        !state.computing
      ) {
        return;
      }
      const token = ++computeToken;
      state.computing = true;
      const trials = omaha ? OMAHA_TRIALS : DEFAULT_TRIALS;
      const tag = omaha ? (state.variant === 'omaha-hl' ? 'Omaha Hi' : 'Omaha') : 'NLH';
      state.status = '计算中… ' + tag + ' (' + reason + ')';
      render();

      // Yield so overlay paints, then run MC
      setTimeout(function () {
        if (token !== computeToken) return;
        if (isTabHidden()) {
          // Tab hid mid-queue — keep signature pending for visibility resume.
          state.computing = false;
          pendingComputeWhileHidden = true;
          pendingComputeReason = reason || pendingComputeReason || '可见后补算';
          return;
        }
        try {
          const res = omaha
            ? monteCarloOmaha(state.hero, state.board, state.opponents, trials, {
                hiLo: state.variant === 'omaha-hl',
              })
            : monteCarlo(state.hero, state.board, state.opponents, trials);
          if (token !== computeToken) return;
          if (!res) {
            state.status = '无法计算（牌面冲突？）';
            state.computing = false;
            state.win = state.tie = state.lose = null;
            state.lowWin = state.lowTie = state.lowLose = null;
            state.noLow = state.scoop = null;
            state.hiLo = false;
            state.beatProbs = null;
            lastComputeKey = '';
            render();
            return;
          }
          state.win = res.win;
          state.tie = res.tie;
          state.lose = res.lose;
          state.trials = res.trials;
          if (res.hiLo) {
            state.lowWin = res.lowWin;
            state.lowTie = res.lowTie;
            state.lowLose = res.lowLose;
            state.noLow = res.noLow;
            state.scoop = res.scoop;
            state.hiLo = true;
          } else {
            state.lowWin = state.lowTie = state.lowLose = null;
            state.noLow = null;
            state.scoop = null;
            state.hiLo = false;
          }
          state.beatProbs = {
            cats: res.beatCats || {},
            pockets: res.beatPockets || {},
            trials: res.trials,
            higherTwoPair: state._higherTwoPair !== false,
          };
          state.lastUpdate = new Date();
          state.computing = false;
          lastNullRetryKey = '';
          lastComputeKey = sig;
          refreshAnalysis();
          state.status = state.alerts.length ? state.alerts[0].text : '就绪';
          render();
        } catch (err) {
          state.computing = false;
          state.win = state.tie = state.lose = null;
          state.lowWin = state.lowTie = state.lowLose = null;
          state.noLow = state.scoop = null;
          state.hiLo = false;
          state.beatProbs = null;
          lastComputeKey = '';
          state.status = '计算错误: ' + (err && err.message ? err.message : String(err));
          render();
        }
      }, 16);
    }

    /**
     * Queue equity MC. Debounces DOM-driven twitches; skips when tab hidden.
     * opts.immediate: bypass debounce (manual buttons).
     */
    function scheduleCompute(reason, opts) {
      opts = opts || {};
      if (isTabHidden()) {
        pendingComputeWhileHidden = true;
        pendingComputeReason = reason || pendingComputeReason || '可见后补算';
        return;
      }
      pendingComputeReason = reason || 'update';
      if (opts.immediate) {
        if (computeDebounceTimer) {
          clearTimeout(computeDebounceTimer);
          computeDebounceTimer = 0;
        }
        runComputeNow(pendingComputeReason);
        return;
      }
      if (computeDebounceTimer) {
        clearTimeout(computeDebounceTimer);
      }
      computeDebounceTimer = setTimeout(function () {
        computeDebounceTimer = 0;
        if (isTabHidden()) {
          pendingComputeWhileHidden = true;
          return;
        }
        runComputeNow(pendingComputeReason || reason || 'update');
      }, COMPUTE_DEBOUNCE_MS);
    }


    function resetHand() {
      state.hero = [];
      state.board = [];
      state.opponents = 0;
      state.win = state.tie = state.lose = null;
      state.lowWin = state.lowTie = state.lowLose = null;
      state.noLow = state.scoop = null;
      state.hiLo = false;
      state.trials = 0;
      state.beatProbs = null;
      state.status = '新手牌…';
      state.oppManualThisHand = false;
      state.variant = 'holdem';
      lastDomHeroKey = '';
      lastDomBoardKey = '';
      domMissLogged = false;
      lastNullRetryKey = '';
      lastComputeKey = '';
      pendingComputeWhileHidden = false;
      pendingComputeReason = '';
      if (computeDebounceTimer) {
        clearTimeout(computeDebounceTimer);
        computeDebounceTimer = 0;
      }
    }

    function setHeroFromPlayers(playerHands) {
      if (!Array.isArray(playerHands)) return false;
      state.opponents = Math.max(0, playerHands.length - 1);
      let hero = null;
      for (let i = 0; i < playerHands.length; i++) {
        const p = playerHands[i];
        const cards = (p && p.cards) || p;
        if (!Array.isArray(cards) || cards.length < 2) continue;
        // Take every visible hole card (Hold'em 2 / Omaha 4). Old path only kept 2,
        // so Omaha console deals left hero.length===2 → scheduleCompute early-return
        // cleared equity while analyzeSituation still painted gap labels.
        const normalized = [];
        const seen = {};
        for (let j = 0; j < cards.length && normalized.length < 4; j++) {
          const c = normalizeCard(cards[j]);
          if (!c || seen[c]) continue;
          seen[c] = true;
          normalized.push(c);
        }
        if (normalized.length >= 2) {
          hero = normalized;
          break;
        }
      }
      if (!hero) {
        state.hero = [];
        state.status = '本手未入局（无可见手牌）';
        render();
        return false;
      }
      state.hero = hero;
      state.board = [];
      state.source = 'console';
      state.status = '检测到手牌';
      try {
        state.variant = detectGameVariant();
      } catch (_) {}
      // Console JSON sometimes lists only hero → opponents=0 would skip equity forever.
      if (state.opponents < 1) {
        try {
          syncOpponentsFromDom({ force: true });
        } catch (_) {}
        if (state.opponents < 1) state.opponents = 1;
      }
      lastNullRetryKey = '';
      scheduleCompute('新手牌');
      return true;
    }

    function appendBoard(newCards) {
      if (!Array.isArray(newCards)) return;
      const added = [];
      for (let i = 0; i < newCards.length; i++) {
        const c = normalizeCard(newCards[i]);
        if (!c) continue;
        if (state.hero.indexOf(c) >= 0) continue;
        if (state.board.indexOf(c) >= 0) continue;
        added.push(c);
      }
      if (!added.length) return;
      state.board = state.board.concat(added).slice(0, 5);
      state.source = state.source === 'dom' ? 'dom' : 'console';
      state.status = '公共牌更新';
      scheduleCompute('公共牌');
    }

    // ─── Console.info hook ──────────────────────────────────────────────
    function extractJSON(raw) {
      const s = String(raw);
      let idx = s.indexOf('): ');
      if (idx >= 0) return s.slice(idx + 3);
      idx = s.indexOf(') : ');
      if (idx >= 0) return s.slice(idx + 4);
      // last resort: first '[' or '{'
      const b = s.search(/[\[{]/);
      if (b >= 0) return s.slice(b);
      return null;
    }

    function handleConsoleMessage(args) {
      const raw = Array.prototype.map.call(args, function (a) {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch (_) {
          return String(a);
        }
      }).join(' ');

      if (raw.indexOf('Hole cards') >= 0) {
        try {
          const jsonStr = extractJSON(raw);
          const data = JSON.parse(jsonStr);
          resetHand();
          setHeroFromPlayers(data);
        } catch (e) {
          state.status = 'Hole cards 解析失败';
          render();
        }
        return;
      }
      if (raw.indexOf('Community cards') >= 0) {
        try {
          const jsonStr = extractJSON(raw);
          const data = JSON.parse(jsonStr);
          appendBoard(data);
        } catch (e) {
          state.status = 'Community cards 解析失败';
          render();
        }
      }
    }

    const origInfo = console.info ? console.info.bind(console) : function () {};
    function rpInfoHook() {
      try {
        handleConsoleMessage(arguments);
      } catch (_) {}
      return origInfo.apply(console, arguments);
    }
    rpInfoHook.__rpOddsHook = true;
    console.info = rpInfoHook;
    // Some builds may log via console.log
    const origLog = console.log ? console.log.bind(console) : function () {};
    function rpLogHook() {
      try {
        const raw = Array.prototype.join.call(arguments, ' ');
        if (raw.indexOf('Hole cards') >= 0 || raw.indexOf('Community cards') >= 0) {
          handleConsoleMessage(arguments);
        }
      } catch (_) {}
      return origLog.apply(console, arguments);
    }
    rpLogHook.__rpOddsHook = true;
    console.log = rpLogHook;

    setInterval(function () {
      if (!console.info || !console.info.__rpOddsHook) {
        const prev = console.info ? console.info.bind(console) : function () {};
        function h() {
          try { handleConsoleMessage(arguments); } catch (_) {}
          return prev.apply(console, arguments);
        }
        h.__rpOddsHook = true;
        console.info = h;
      }
      if (!console.log || !console.log.__rpOddsHook) {
        const prev = console.log ? console.log.bind(console) : function () {};
        function h() {
          try {
            const raw = Array.prototype.join.call(arguments, ' ');
            if (raw.indexOf('Hole cards') >= 0 || raw.indexOf('Community cards') >= 0) {
              handleConsoleMessage(arguments);
            }
          } catch (_) {}
          return prev.apply(console, arguments);
        }
        h.__rpOddsHook = true;
        console.log = h;
      }
    }, 4000);

    // ─── DOM fallback (casino.org Replay Poker HTML+SVG) ────────────────
    const RANK_WORDS = {
      two: '2', deuce: '2', three: '3', four: '4', five: '5', six: '6',
      seven: '7', eight: '8', nine: '9', ten: 'T', jack: 'J', queen: 'Q',
      king: 'K', ace: 'A',
    };
    const SUIT_WORDS = {
      spade: 's', spades: 's', heart: 'h', hearts: 'h',
      diamond: 'd', diamonds: 'd', club: 'c', clubs: 'c',
    };
    const CARD_CODE_RE = /^[2-9TJQKA][hdcs]$/i;
    const FACE_CLASS_RE = /Card__face-([2-9TJQKA][hdcs])/i;
    const FACE_WORD_RE = /\b([2-9TJQKA][hdcs])\b/i;
    const PNG_CARD_RE = /cards\/regular\/([2-9TJQKA][hdcs])\.png/i;
    const SUIT_PIP_RE = /Card__pips--(heart|diamond|club|spade)/i;
    const SUIT_PIP_MAP = { heart: 'h', diamond: 'd', club: 'c', spade: 's' };

    function cardFromBlob(text) {
      if (!text) return null;
      const t = String(text);
      let c = normalizeCard(t);
      if (c) return c;
      const mFace = t.match(FACE_CLASS_RE) || t.match(FACE_WORD_RE);
      if (mFace) {
        c = normalizeCard(mFace[1]);
        if (c) return c;
      }
      const mPng = t.match(PNG_CARD_RE);
      if (mPng) {
        c = normalizeCard(mPng[1]);
        if (c) return c;
      }
      const m1 = t.match(/\b(ace|king|queen|jack|ten|two|three|four|five|six|seven|eight|nine|deuce|\d+|T|J|Q|K|A)\b[^\w]{0,12}\b(of\s+)?(spades?|hearts?|diamonds?|clubs?|[shdc])\b/i);
      if (m1) {
        let r = m1[1].toLowerCase();
        r = RANK_WORDS[r] || (r.length === 1 ? r.toUpperCase() : r === '10' ? 'T' : null);
        let s = m1[3].toLowerCase();
        s = SUIT_WORDS[s] || (s.length === 1 ? s : null);
        if (r && s) return normalizeCard(r + s);
      }
      const mr = t.match(/rank[-_]?([2-9TJQKA]|10)/i);
      const ms = t.match(/suit[-_]?([shdc]|spade|heart|diamond|club)/i);
      if (mr && ms) {
        let r = mr[1].toUpperCase();
        if (r === '10') r = 'T';
        let s = ms[1].toLowerCase();
        s = SUIT_WORDS[s] || s[0];
        return normalizeCard(r + s);
      }
      return null;
    }

    function readSuitOnlyFromEl(el) {
      if (!el) return null;
      const blob = (el.className || '') + ' ' + (el.innerHTML || '');
      const m = blob.match(SUIT_PIP_RE);
      if (m) return SUIT_PIP_MAP[m[1].toLowerCase()] || null;
      return null;
    }

    function deepFindCardCodes(obj, depth, seen, out) {
      if (obj == null || depth > 8 || out.length >= 4) return;
      const t = typeof obj;
      if (t === 'string') {
        if (CARD_CODE_RE.test(obj) && obj.toUpperCase() !== 'X' && obj[0] !== 'X' && obj[0] !== 'x') {
          const n = normalizeCard(obj);
          if (n && out.indexOf(n) < 0) out.push(n);
        }
        return;
      }
      if (t !== 'object') return;
      if (seen.has(obj)) return;
      // Skip huge / DOM / window-ish
      if (typeof Node !== 'undefined' && obj instanceof Node) return;
      if (obj === window || obj === document) return;
      try {
        seen.add(obj);
      } catch (_) {
        return;
      }
      if (Array.isArray(obj)) {
        if (obj.length > 64) return;
        for (let i = 0; i < obj.length && out.length < 4; i++) {
          deepFindCardCodes(obj[i], depth + 1, seen, out);
        }
        return;
      }
      let keys;
      try {
        keys = Object.keys(obj);
      } catch (_) {
        return;
      }
      if (keys.length > 80) return;
      for (let i = 0; i < keys.length && out.length < 4; i++) {
        const k = keys[i];
        // Prefer likely prop names but still scan all within depth
        try {
          deepFindCardCodes(obj[k], depth + 1, seen, out);
        } catch (_) {}
      }
    }

    function readCardsFromReact(el) {
      if (!el) return [];
      const keys = Object.keys(el);
      const out = [];
      const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : { add: function () {}, has: function () { return false; } };
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (
          k.indexOf('__reactFiber$') === 0 ||
          k.indexOf('__reactProps$') === 0 ||
          k.indexOf('__reactInternalInstance$') === 0 ||
          k.indexOf('__reactContainer$') === 0
        ) {
          try {
            deepFindCardCodes(el[k], 0, seen, out);
          } catch (_) {}
        }
      }
      return out;
    }

    function cardIndexFromEl(el) {
      const m = String(el.className || '').match(/Card--(\d+)\b/);
      return m ? Number(m[1]) : -1;
    }

    /**
     * Read a single .Card--withValue element → "As" style code, or null.
     * Returns { code, suitOnly } where suitOnly means rank missing from SVG.
     */
    function readCardFromEl(el) {
      if (!el) return { code: null, suitOnly: false };
      // 1) Face class Card__face-Jh
      const classBlob = String(el.className || '');
      let m = classBlob.match(FACE_CLASS_RE) || classBlob.match(FACE_WORD_RE);
      if (m) {
        const c = normalizeCard(m[1]);
        if (c) return { code: c, suitOnly: false };
      }
      // Scan descendants' class for face
      const faceNodes = el.querySelectorAll('[class*="Card__face"], [class*="Card__face-"]');
      for (let i = 0; i < faceNodes.length; i++) {
        const fc = String(faceNodes[i].className || '');
        m = fc.match(FACE_CLASS_RE) || fc.match(FACE_WORD_RE);
        if (m) {
          const c = normalizeCard(m[1]);
          if (c) return { code: c, suitOnly: false };
        }
      }
      // 2) SVG image href / img src …/cards/regular/Jh.png (skip X.png)
      const imgs = el.querySelectorAll('image, img');
      for (let i = 0; i < imgs.length; i++) {
        const node = imgs[i];
        const hrefs = [
          node.getAttribute('href'),
          node.getAttributeNS && node.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
          node.getAttribute('xlink:href'),
          node.getAttribute('src'),
          node.getAttribute('data-src'),
        ];
        for (let j = 0; j < hrefs.length; j++) {
          const h = hrefs[j];
          if (!h || /\/X\.png/i.test(h)) continue;
          const pm = String(h).match(PNG_CARD_RE);
          if (pm) {
            const c = normalizeCard(pm[1]);
            if (c) return { code: c, suitOnly: false };
          }
        }
      }
      // 3) React fiber / props deep search
      const fromReact = readCardsFromReact(el);
      if (fromReact.length === 1) return { code: fromReact[0], suitOnly: false };
      if (fromReact.length > 1) {
        const ix = cardIndexFromEl(el);
        if (ix >= 0 && ix < fromReact.length) return { code: fromReact[ix], suitOnly: false };
        return { code: fromReact[0], suitOnly: false };
      }
      // Parent hole/community wrappers often hold the card array
      let parent = el.parentElement;
      for (let up = 0; parent && up < 3; up++, parent = parent.parentElement) {
        const fromParent = readCardsFromReact(parent);
        if (!fromParent.length) continue;
        const ix = cardIndexFromEl(el);
        if (ix >= 0 && ix < fromParent.length) return { code: fromParent[ix], suitOnly: false };
        if (fromParent.length === 1) return { code: fromParent[0], suitOnly: false };
      }
      // 4) Blob fallback
      const blobs = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-card'),
        el.getAttribute('data-value'),
        classBlob,
        el.textContent,
      ];
      for (let i = 0; i < blobs.length; i++) {
        const c = cardFromBlob(blobs[i]);
        if (c) return { code: c, suitOnly: false };
      }
      // Suit-only (A/2–10 pip SVG)
      const suit = readSuitOnlyFromEl(el);
      if (suit) return { code: null, suitOnly: true, suit: suit };
      return { code: null, suitOnly: false };
    }

    function readCardsFromNodeList(nodeList) {
      const codes = [];
      let suitOnlyHits = 0;
      const seen = {};
      for (let i = 0; i < nodeList.length; i++) {
        const r = readCardFromEl(nodeList[i]);
        if (r.code && !seen[r.code]) {
          seen[r.code] = true;
          codes.push(r.code);
        } else if (r.suitOnly) {
          suitOnlyHits++;
        }
      }
      return { codes: codes, suitOnlyHits: suitOnlyHits };
    }

    function scrapeHeroDom() {
      let nodes = document.querySelectorAll(
        '.Cards__holeCards.Cards--mine .Card.Card--withValue, .Cards__holeCards.Cards--mine .Card--withValue'
      );
      if (!nodes.length) {
        nodes = document.querySelectorAll('.Cards__holeCards.Cards--mine .Card');
      }
      return readCardsFromNodeList(nodes);
    }

    function scrapeBoardDom() {
      const nodes = document.querySelectorAll(
        '.Cards__communityCards .Card.Card--withValue, .Cards__communityCards .Card--withValue'
      );
      return readCardsFromNodeList(nodes);
    }

    function detectGameVariant() {
      // Default Hold'em. Never infer Omaha from lobby/page copy or a partial
      // 2-card hole read — that mislabeled NLH as「Omaha · 胜+平」.
      // Only Omaha when table CSS is explicit, or hero clearly shows 4 valued cards.
      try {
        const nodes = document.querySelectorAll(
          '.Game--holdem, .Game--omaha, .Game--omahaHiLo, [class*="Game--"]'
        );
        let sawHoldem = false;
        for (let i = 0; i < nodes.length; i++) {
          const parts = String(nodes[i].className || '').split(/\s+/);
          for (let j = 0; j < parts.length; j++) {
            const c = parts[j];
            if (!c) continue;
            if (c === 'Game--omahaHiLo') return 'omaha-hl';
            if (c === 'Game--omaha') return 'omaha';
            if (c === 'Game--holdem') sawHoldem = true;
          }
        }
        if (sawHoldem) return 'holdem';
      } catch (_) {}
      // Explicit class query fallback (some builds only expose these)
      try {
        if (document.querySelector('.Game--omahaHiLo')) return 'omaha-hl';
        if (document.querySelector('.Game--omaha')) return 'omaha';
        if (document.querySelector('.Game--holdem')) return 'holdem';
      } catch (_) {}
      // Hero hole: require 4 cards with values (not empty .Card shells / 2-card NLH)
      try {
        const mine = document.querySelector('.Cards__holeCards.Cards--mine');
        if (mine) {
          let valued = mine.querySelectorAll('.Card.Card--withValue').length;
          if (valued < 4) {
            // Fallback: countable face codes via existing reader path
            valued = 0;
            const cards = mine.querySelectorAll('.Card');
            for (let i = 0; i < cards.length; i++) {
              try {
                const got = readCardFromEl(cards[i]);
                if (got && got.code) valued++;
              } catch (_) {}
            }
          }
          if (valued >= 4) return 'omaha';
        }
      } catch (_) {}
      return 'holdem';
    }

    function isOmahaVariant(v) {
      return v === 'omaha' || v === 'omaha-hl';
    }

    function estimateOpponentsDom() {
      // Count seats that still show hole cards (2 for Hold'em, 4 for Omaha).
      // Folded seats typically lose their card nodes — that is the signal.
      let holes;
      try {
        holes = document.querySelectorAll('.Cards__holeCards:not(.Cards--mine)');
      } catch (_) {
        return 0;
      }
      const seen = new Set();
      let n = 0;
      const minCards = isOmahaVariant(state.variant) ? 3 : 2;
      for (let i = 0; i < holes.length; i++) {
        const hole = holes[i];
        const cls = String(hole.className || '');
        if (/folded|mucked/i.test(cls)) continue;
        let seat = hole;
        try {
          seat = hole.closest('.Seat, [class*="Seat"]') || hole;
        } catch (_) {}
        const scls = String((seat && seat.className) || '');
        if (/folded|mucked|empty|sittingOut|sit-out|sitOut/i.test(scls)) continue;
        if (seen.has(seat)) continue;
        let cards = [];
        try {
          cards = hole.querySelectorAll('.Card');
        } catch (_) {}
        if (!cards.length) {
          try {
            cards = hole.querySelectorAll('[class*="Card"]');
          } catch (_) {}
        }
        if (cards.length < minCards) continue;
        seen.add(seat);
        n++;
      }
      return n;
    }

    /**
     * Snapshot opponents at hand start only.
     * Do NOT auto-decrease on folds: survivors are stronger than random,
     * so fewer-random-opponent equity is biased high.
     */
    function syncOpponentsFromDom(opts) {
      opts = opts || {};
      const force = !!opts.force; // new hole cards / hand reset
      try {
        state.variant = detectGameVariant();
      } catch (_) {}
      let n = 0;
      try {
        n = estimateOpponentsDom();
      } catch (_) {
        return false;
      }
      if (n < 1) return false;
      n = Math.max(1, Math.min(9, n | 0));

      if (!force) {
        // Mid-hand: never change automatically (especially never decrease)
        return false;
      }
      if (n === state.opponents) return false;
      const prev = state.opponents;
      state.opponents = n;
      state.oppManualThisHand = false;
      if (prev > 0 && n !== prev) {
        state.status = '开局对手 ' + n + '（弃牌不自动减，避免虚高）';
      }
      return true;
    }

    function pollDom() {
      try {
        if (isTabHidden()) return;
        if (
          !document.querySelector('.Cards__holeCards, .Cards__communityCards, .Card.Card--withValue, .Game--holdem, .Game--omaha, .Game--omahaHiLo')
        ) {
          return;
        }

        const heroScrape = scrapeHeroDom();
        const boardScrape = scrapeBoardDom();
        const heroCodes = heroScrape.codes;
        const boardCodes = boardScrape.codes;
        const suitOnly =
          heroScrape.suitOnlyHits > 0 || boardScrape.suitOnlyHits > 0;

        const hasAnyMarkup =
          document.querySelector('.Cards__holeCards.Cards--mine, .Cards__communityCards');

        if (!heroCodes.length && !boardCodes.length) {
          if (!domMissLogged && state.source !== 'console') {
            if (suitOnly) {
              state.status = 'DOM 仅花色可读，等 console 补点数';
            } else if (hasAnyMarkup) {
              state.status = 'DOM 未识别完整牌面，等 console 发牌日志';
            } else {
              state.status = 'DOM 未识别，等 console 发牌日志';
            }
            domMissLogged = true;
            render();
          }
          return;
        }

        let changed = false;
        let usedDomHero = false;
        let usedDomBoard = false;

        let variantNow = state.variant;
        try {
          variantNow = detectGameVariant();
          state.variant = variantNow;
        } catch (_) {}
        const needHero = isOmahaVariant(variantNow) ? 4 : 2;
        const consoleComplete =
          state.source === 'console' && state.hero.length >= needHero;

        // Hero: prefer a complete console hand; allow DOM to upgrade incomplete
        // Omaha (console historically kept only 2 of 4) or fill when console missed.
        if (consoleComplete) {
          // keep console hero
        } else if (heroCodes.length >= 2) {
          const hero = heroCodes.slice(0, Math.min(needHero, heroCodes.length));
          const hk = cardsKey(hero);
          const cur = cardsKey(state.hero);
          const upgradesIncomplete =
            state.hero.length > 0 && hero.length > state.hero.length;
          const different = hk !== cur || hero.length !== state.hero.length;
          // Do not shrink a longer console partial with a shorter DOM scrape
          if (state.source === 'console' && state.hero.length > hero.length) {
            // keep longer console partial; wait for more cards
          } else if (
            hk !== lastDomHeroKey ||
            different ||
            upgradesIncomplete
          ) {
            lastDomHeroKey = hk;
            state.hero = hero;
            if (state.source !== 'console') state.source = 'dom';
            usedDomHero = true;
            changed = true;

            syncOpponentsFromDom({ force: true });
            if (state.opponents < 1) state.opponents = 1;
          }
        }

        // Board: allow DOM to fill/update even when source is console (community may be missed)
        if (boardCodes.length) {
          const board = boardCodes.slice(0, 5);
          // Drop any that collide with hero
          const filtered = [];
          for (let i = 0; i < board.length; i++) {
            if (state.hero.indexOf(board[i]) >= 0) continue;
            filtered.push(board[i]);
          }
          const bk = cardsKey(filtered);
          if (bk && bk !== lastDomBoardKey && (bk !== cardsKey(state.board) || filtered.length > state.board.length)) {
            lastDomBoardKey = bk;
            // If console already has equal/longer board, don't shrink; else adopt DOM
            if (state.source === 'console' && state.board.length >= filtered.length && cardsKey(state.board) === bk) {
              // same
            } else if (state.source === 'console' && state.board.length > filtered.length) {
              // keep longer console board
            } else {
              state.board = filtered;
              usedDomBoard = true;
              changed = true;
            }
          }
        }

        if (suitOnly && (!heroCodes.length || heroCodes.length < 2) && state.source !== 'console') {
          state.status = 'DOM 仅花色可读，等 console 补点数';
          render();
          return;
        }

        // Variant only mid-hand — opponent count locked at deal (no auto fold-down)
        try {
          state.variant = detectGameVariant();
        } catch (_) {}
        if (state.opponents < 1 && state.hero.length >= 2) {
          // First paint fallback if deal sync missed — always mark changed so equity runs
          if (syncOpponentsFromDom({ force: true })) {
            changed = true;
          } else {
            state.opponents = 1;
            changed = true;
          }
        }

        if (changed) {
          if (usedDomHero && usedDomBoard) {
            state.status = 'DOM 手牌+公共牌';
          } else if (usedDomHero) {
            state.status = 'DOM 手牌';
          } else if (usedDomBoard) {
            state.status = state.source === 'console' ? 'DOM 补公共牌' : 'DOM 公共牌';
          }
          if (state.source !== 'console' && (usedDomHero || usedDomBoard)) {
            state.source = 'dom';
          }
          lastNullRetryKey = '';
          scheduleCompute(usedDomHero ? 'DOM手牌' : 'DOM公共牌');
        } else if (suitOnly && state.source !== 'console' && state.hero.length < 2) {
          state.status = 'DOM 仅花色可读，等 console 补点数';
          render();
        } else {
          // Overlay booted mid-hand / SPA nav: cards stable but win still null → one retry
          const need = isOmahaVariant(state.variant) ? 4 : 2;
          if (
            !state.computing &&
            state.win == null &&
            state.hero.length >= need &&
            state.opponents >= 1
          ) {
            const retryKey =
              cardsKey(state.hero) +
              '|' +
              cardsKey(state.board) +
              '|' +
              state.opponents +
              '|' +
              state.variant;
            if (retryKey !== lastNullRetryKey) {
              lastNullRetryKey = retryKey;
              scheduleCompute('补算');
            }
          }
        }
        // refresh pot / call quietly for sizing + pot-odds tip
        try {
          let dirty = false;
          const pot = scrapePotDom();
          if (pot != null && pot !== state.pot) {
            state.pot = pot;
            dirty = true;
          }
          const callAmt = scrapeCallDom();
          if (callAmt !== state.callAmount) {
            state.callAmount = callAmt;
            dirty = true;
          }
          if (dirty) {
            refreshAnalysis();
            render();
          }
        } catch (_) {}
      } catch (_) {}
    }

    setInterval(function () {
      if (isTabHidden()) return;
      pollDom();
    }, DOM_POLL_MS);

    function schedulePollDomSoon() {
      if (isTabHidden()) return;
      if (pollDomSoonTimer) return;
      pollDomSoonTimer = setTimeout(function () {
        pollDomSoonTimer = 0;
        try {
          if (!isTabHidden()) pollDom();
        } catch (_) {}
      }, DOM_MUTATION_DEBOUNCE_MS);
    }

    function bindDomObserver() {
      let target = null;
      try {
        target =
          document.querySelector(
            '.Game--holdem, .Game--omaha, .Game--omahaHiLo, [class*="Game--"], .Cards__holeCards, #root, #app, main'
          ) || document.body;
      } catch (_) {
        target = document.body;
      }
      if (!target) return false;
      if (domObserver && observedRoot === target && document.contains(observedRoot)) {
        return true;
      }
      if (domObserver) {
        try {
          domObserver.disconnect();
        } catch (_) {}
        domObserver = null;
      }
      observedRoot = target;
      try {
        domObserver = new MutationObserver(function () {
          schedulePollDomSoon();
        });
        domObserver.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'href', 'src'],
        });
      } catch (_) {
        try {
          domObserver = new MutationObserver(function () {
            schedulePollDomSoon();
          });
          domObserver.observe(target, { childList: true, subtree: true });
        } catch (_) {
          domObserver = null;
          observedRoot = null;
          return false;
        }
      }
      return true;
    }

    // document_start runs before the table mounts; rebind when SPA swaps the root.
    setInterval(function () {
      if (isTabHidden()) return;
      try {
        const table = document.querySelector(
          '.Cards__holeCards, .Cards__communityCards, .Game--holdem, .Game--omaha, [class*="Game--"]'
        );
        const rootDead = observedRoot && !document.contains(observedRoot);
        const tableOutside =
          table &&
          observedRoot &&
          observedRoot !== document.body &&
          observedRoot !== table &&
          !observedRoot.contains(table);
        if (!domObserver || rootDead || tableOutside) {
          observedRoot = null;
          bindDomObserver();
          pollDom();
        }
      } catch (_) {}
    }, OBSERVER_REBIND_MS);

    bindDomObserver();

    // Resume DOM poll + pending MC when the tab is shown again.
    try {
      document.addEventListener(
        'visibilitychange',
        function () {
          if (isTabHidden()) return;
          try {
            pollDom();
          } catch (_) {}
          if (pendingComputeWhileHidden) {
            pendingComputeWhileHidden = false;
            scheduleCompute(pendingComputeReason || '可见后补算', { immediate: true });
          }
        },
        false
      );
    } catch (_) {}

    // ─── Bottom bar UI (no sidebar, no viewport hacking) ───────────────
    function fmtPct(v) {
      if (v == null || isNaN(v)) return '—';
      return (Math.round(v * 100) / 100).toFixed(1) + '%';
    }
    /** Equity ≈ win + tie (tie counted in full, same as common HUD display). */
    function equityValue() {
      if (state.win == null || isNaN(state.win)) return null;
      const tie = state.tie == null || isNaN(state.tie) ? 0 : state.tie;
      return state.win + tie;
    }
    function equityTone(eq) {
      if (eq == null || isNaN(eq)) return '#9aa8bc';
      if (eq >= 60) return '#3dde7a';
      if (eq >= 45) return '#f0c04e';
      return '#ff8f7a';
    }
    function fmtCards(arr) {
      return arr && arr.length ? arr.join(' ') : '—';
    }
    function fmtTime(d) {
      if (!d) return '—';
      const pad = function (n) {
        return n < 10 ? '0' + n : '' + n;
      };
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    const UI_KEY = 'rp-odds-bottombar-v1';
    function loadUiPref() {
      try {
        return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {};
      } catch (_) {
        return {};
      }
    }
    function saveUiPref(patch) {
      try {
        const cur = loadUiPref();
        Object.assign(cur, patch);
        localStorage.setItem(UI_KEY, JSON.stringify(cur));
      } catch (_) {}
    }

    let root = null;
    let els = {};
    let uiExpanded = false;

    function teardownDockHacks() {
      try {
        const html = document.documentElement;
        html.classList.remove('rp-odds-dock');
        html.style.removeProperty('--rp-odds-rail');
        html.style.removeProperty('--rp-odds-scale');
        html.style.removeProperty('--rp-odds-inv');
        html.style.removeProperty('width');
        html.style.removeProperty('max-width');
        const body = document.body;
        if (body) {
          body.style.removeProperty('width');
          body.style.removeProperty('max-width');
          body.style.removeProperty('overflow-x');
          const kids = body.children;
          for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            if (!el || el.id === 'rp-odds-overlay' || el.id === 'rp-odds-special') continue;
            el.style.removeProperty('transform');
            el.style.removeProperty('transform-origin');
            el.style.removeProperty('width');
            el.style.removeProperty('max-width');
            el.style.removeProperty('height');
            el.style.removeProperty('min-height');
            el.style.removeProperty('right');
            el.style.removeProperty('left');
            el.removeAttribute('data-rp-fixedbleed');
          }
        }
        const st = document.getElementById('rp-odds-dock-style');
        if (st) st.remove();
      } catch (_) {}
    }

    let dragState = null;

    function clampPos(left, top) {
      const w = (root && root.offsetWidth) || 160;
      const h = (root && root.offsetHeight) || 36;
      const maxL = Math.max(4, window.innerWidth - w - 4);
      const maxT = Math.max(4, window.innerHeight - h - 4);
      return {
        left: Math.min(maxL, Math.max(4, left)),
        top: Math.min(maxT, Math.max(4, top)),
      };
    }

    function applyBarChrome() {
      if (!root) return;
      const expanded = uiExpanded;
      const pref = loadUiPref();
      Object.assign(root.style, {
        position: 'fixed',
        right: 'auto',
        zIndex: '2147483646',
        width: 'auto',
        maxWidth: 'min(300px, calc(100vw - 20px))',
        minWidth: expanded ? '220px' : '0',
        boxSizing: 'border-box',
        margin: '0',
        padding: expanded ? '8px 9px 8px' : '5px 8px',
        color: '#e8eef7',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '12px',
        lineHeight: '1.35',
        pointerEvents: 'auto',
        userSelect: 'none',
        background: 'rgba(8, 12, 20, 0.52)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '12px',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        gap: expanded ? '6px' : '0',
        transition: 'border-radius .15s ease, padding .15s ease',
        overflow: 'hidden',
        cursor: 'grab',
      });
      if (pref.left != null && pref.top != null) {
        const pos = clampPos(Number(pref.left), Number(pref.top));
        root.style.left = pos.left + 'px';
        root.style.top = pos.top + 'px';
        root.style.bottom = 'auto';
        root.style.transform = 'none';
      } else {
        root.style.left = '50%';
        root.style.top = 'auto';
        root.style.bottom = '10px';
        root.style.transform = 'translateX(-50%)';
      }
      if (els.compact) els.compact.style.display = expanded ? 'none' : 'flex';
      if (els.detail) els.detail.style.display = expanded ? 'block' : 'none';
    }

    function bindDrag() {
      if (!root || root.__rpDragBound) return;
      root.__rpDragBound = true;
      root.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;
        e.preventDefault();
        const rect = root.getBoundingClientRect();
        // Switch from centered transform to absolute coords for dragging
        root.style.transform = 'none';
        root.style.bottom = 'auto';
        root.style.left = rect.left + 'px';
        root.style.top = rect.top + 'px';
        dragState = {
          ox: e.clientX - rect.left,
          oy: e.clientY - rect.top,
          moved: false,
        };
        root.style.cursor = 'grabbing';
        try {
          root.setPointerCapture(e.pointerId);
        } catch (_) {}
      });
      root.addEventListener('pointermove', function (e) {
        if (!dragState) return;
        dragState.moved = true;
        const pos = clampPos(e.clientX - dragState.ox, e.clientY - dragState.oy);
        root.style.left = pos.left + 'px';
        root.style.top = pos.top + 'px';
      });
      function endDrag(e) {
        if (!dragState) return;
        const moved = dragState.moved;
        dragState = null;
        root.style.cursor = 'grab';
        const rect = root.getBoundingClientRect();
        const pos = clampPos(rect.left, rect.top);
        root.style.left = pos.left + 'px';
        root.style.top = pos.top + 'px';
        root.style.transform = 'none';
        root.style.bottom = 'auto';
        saveUiPref({ left: pos.left, top: pos.top });
        try {
          root.releasePointerCapture(e.pointerId);
        } catch (_) {}
        root.__rpJustDragged = moved;
        setTimeout(function () {
          root.__rpJustDragged = false;
        }, 0);
      }
      root.addEventListener('pointerup', endDrag);
      root.addEventListener('pointercancel', endDrag);
    }

    function setExpanded(next) {
      uiExpanded = !!next;
      saveUiPref({ expanded: uiExpanded });
      applyBarChrome();
      render();
    }

    function ensureOverlay() {
      if (root && document.body.contains(root)) return;
      teardownDockHacks();
      const pref = loadUiPref();
      uiExpanded = !!pref.expanded;

      root = document.createElement('div');
      root.id = 'rp-odds-overlay';
      root.setAttribute('data-rp-odds', '1');
      root.setAttribute('aria-label', 'Replay equity bar');

      root.innerHTML =
        '<div data-k="compact" style="display:flex;flex-direction:column;gap:6px;max-width:min(340px,calc(100vw - 24px));min-width:200px;">' +
        '<div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
        '<span data-k="cDot" style="width:7px;height:7px;border-radius:50%;background:#3dde7a;box-shadow:0 0 8px rgba(61,222,122,.5);flex:0 0 auto;"></span>' +
        '<span style="display:flex;flex-direction:column;gap:0;line-height:1.1;">' +
        '<span data-k="cEq" style="font-weight:750;font-size:14px;letter-spacing:.01em;font-variant-numeric:tabular-nums;color:#3dde7a;">—</span>' +
        '<span data-k="cEqSub" style="font-size:9px;opacity:.55;">胜+平</span>' +
        '<span data-k="cHiLo" style="font-size:9px;opacity:.75;margin-top:2px;display:none;color:#c9d4e5;font-variant-numeric:tabular-nums;"></span>' +
        '</span>' +
        '<span style="opacity:.25;padding:0 2px;">|</span>' +
        '<span data-k="cMade" style="font-weight:650;opacity:.95;">—</span>' +
        '<button type="button" data-act="special" title="特殊概率" style="margin-left:auto;cursor:pointer;border:0;background:rgba(255,255,255,0.08);color:#c9d4e5;border-radius:999px;padding:2px 8px;font-size:11px;">特殊</button><button type="button" data-act="expand" title="详情" style="cursor:pointer;border:0;background:rgba(255,255,255,0.08);color:#c9d4e5;border-radius:999px;padding:2px 8px;font-size:11px;">详情</button>' +
        '</div>' +
        '<div data-k="cAlerts" style="display:none;flex-direction:column;gap:6px;"></div>' +
        '<div data-k="cPotOdds" style="font-size:10px;line-height:1.3;padding:4px 7px;border-radius:8px;background:rgba(120,160,255,0.10);color:#a8c8ff;display:none;white-space:normal;word-break:break-word;"></div>' +
        '<div data-k="cBet" style="font-size:11px;line-height:1.35;padding:5px 8px;border-radius:8px;background:rgba(90,200,160,0.08);color:#8fe3c0;display:none;"></div>' +
        '</div>' +
        '<div data-k="detail" style="display:none;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
        '<div style="font-weight:700;font-size:12px;">权益</div>' +
        '<button type="button" data-act="collapse" style="cursor:pointer;border:0;background:transparent;color:#9aa8bc;font-size:12px;padding:2px 4px;">收起</button>' +
        '</div>' +
        '<div data-k="eqHero" style="font-size:22px;font-weight:750;letter-spacing:.01em;font-variant-numeric:tabular-nums;color:#3dde7a;line-height:1.1;">—</div>' +
        '<div style="font-size:10px;opacity:.55;margin:2px 0 4px;">胜+平 · High</div>' +
        '<div data-k="hiLoBox" style="display:none;margin:0 0 8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.05);font-size:11px;line-height:1.45;font-variant-numeric:tabular-nums;">' +
        '<div data-k="hiLoHigh">High —</div>' +
        '<div data-k="hiLoLow">Low —</div>' +
        '<div data-k="hiLoScoop" style="opacity:.8;">Scoop —</div>' +
        '<div data-k="hiLoNote" style="font-size:9px;opacity:.5;margin-top:2px;">Low：8或更低、无对子；桌面不足则无 Low</div>' +
        '</div>' +
        '<div style="height:6px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;display:flex;margin-bottom:8px;">' +
        '<div data-k="barWin" style="height:100%;background:#3dde7a;width:0%;"></div>' +
        '<div data-k="barTie" style="height:100%;background:#f0c04e;width:0%;"></div>' +
        '<div data-k="barLose" style="height:100%;background:#ff7b7b;width:0%;"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:auto 1fr auto 1fr;column-gap:8px;row-gap:3px;font-variant-numeric:tabular-nums;">' +
        '<span style="opacity:.5;">手牌</span><span data-k="hand">—</span>' +
        '<span style="opacity:.5;">公共</span><span data-k="board">—</span>' +
        '<span style="opacity:.5;">对手</span><span data-k="opp">—</span>' +
        '<span style="opacity:.5;">胜</span><span data-k="win" style="color:#3dde7a;">—</span>' +
        '<span style="opacity:.5;">平</span><span data-k="tie" style="color:#f0c04e;">—</span>' +
        '<span style="opacity:.5;">败</span><span data-k="lose" style="color:#ff7b7b;">—</span>' +
        '</div>' +
        '<div data-k="meta" style="opacity:.45;font-size:10px;margin-top:6px;">—</div>' +
        '<div data-k="status" style="opacity:.7;font-size:10px;margin-top:2px;min-height:1.2em;"></div>' +
        '<div data-k="madeLine" style="margin-top:6px;font-size:12px;font-weight:650;">成牌：—</div>' +
        '<div data-k="potOddsLine" style="margin-top:6px;font-size:11px;padding:5px 8px;border-radius:8px;background:rgba(120,160,255,0.10);color:#a8c8ff;line-height:1.35;display:none;"></div>' +
        '<div data-k="potOddsDetail" style="margin-top:2px;font-size:10px;opacity:.55;line-height:1.3;display:none;"></div>' +
        '<div data-k="betLine" style="margin-top:6px;font-size:12px;padding:6px 8px;border-radius:8px;background:rgba(90,200,160,0.08);color:#8fe3c0;line-height:1.4;">建议：—</div>' +
        '<div data-k="betDetail" style="margin-top:3px;font-size:10px;opacity:.55;line-height:1.35;"></div>' +
        '<div data-k="alerts" style="margin-top:6px;display:flex;flex-direction:column;gap:4px;"></div>' +
        '<div style="display:flex;gap:6px;margin-top:8px;">' +
        '<button type="button" data-act="fold" style="cursor:pointer;border:0;border-radius:8px;padding:5px 8px;background:rgba(207,66,33,.88);color:#fff;font-size:11px;" title="不推荐：弃牌后留桌范围更强，少人数会虚高权益">对手-1</button>' +
        '<button type="button" data-act="recalc" style="cursor:pointer;border:0;border-radius:8px;padding:5px 8px;background:rgba(42,53,72,.95);color:#fff;font-size:11px;">重算</button>' +
        '<span style="margin-left:auto;font-size:9px;opacity:.4;align-self:center;">不代打</span>' +
        '</div></div>';

      els = {
        compact: root.querySelector('[data-k="compact"]'),
        detail: root.querySelector('[data-k="detail"]'),
        cDot: root.querySelector('[data-k="cDot"]'),
        cEq: root.querySelector('[data-k="cEq"]'),
        cEqSub: root.querySelector('[data-k="cEqSub"]'),
        cHiLo: root.querySelector('[data-k="cHiLo"]'),
        cMade: root.querySelector('[data-k="cMade"]'),
        cBet: root.querySelector('[data-k="cBet"]'),
        cPotOdds: root.querySelector('[data-k="cPotOdds"]'),
        cAlerts: root.querySelector('[data-k="cAlerts"]'),
        eqHero: root.querySelector('[data-k="eqHero"]'),
        hiLoBox: root.querySelector('[data-k="hiLoBox"]'),
        hiLoHigh: root.querySelector('[data-k="hiLoHigh"]'),
        hiLoLow: root.querySelector('[data-k="hiLoLow"]'),
        hiLoScoop: root.querySelector('[data-k="hiLoScoop"]'),
        barWin: root.querySelector('[data-k="barWin"]'),
        barTie: root.querySelector('[data-k="barTie"]'),
        barLose: root.querySelector('[data-k="barLose"]'),
        hand: root.querySelector('[data-k="hand"]'),
        board: root.querySelector('[data-k="board"]'),
        opp: root.querySelector('[data-k="opp"]'),
        win: root.querySelector('[data-k="win"]'),
        tie: root.querySelector('[data-k="tie"]'),
        lose: root.querySelector('[data-k="lose"]'),
        meta: root.querySelector('[data-k="meta"]'),
        status: root.querySelector('[data-k="status"]'),
        madeLine: root.querySelector('[data-k="madeLine"]'),
        potOddsLine: root.querySelector('[data-k="potOddsLine"]'),
        potOddsDetail: root.querySelector('[data-k="potOddsDetail"]'),
        betLine: root.querySelector('[data-k="betLine"]'),
        betDetail: root.querySelector('[data-k="betDetail"]'),
        alerts: root.querySelector('[data-k="alerts"]'),
      };

      applyBarChrome();
      bindDrag();

      root.querySelector('[data-act="expand"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setExpanded(true);
      });
      root.querySelector('[data-act="collapse"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setExpanded(false);
      });
      root.querySelector('[data-act="special"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleSpecialPanel();
      });
      root.querySelector('[data-act="fold"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (state.opponents > 1) {
          state.opponents--;
          state.oppManualThisHand = true;
          scheduleCompute('弃牌-1', { immediate: true });
        } else {
          state.status = '对手数已是最小值 1';
          render();
        }
      });
      root.querySelector('[data-act="recalc"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        scheduleCompute('手动重算', { immediate: true });
      });

      (document.body || document.documentElement).appendChild(root);
    }


    const RANK_LABEL_TO_N = { A: 14, K: 13, Q: 12, J: 11, T: 10, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

    function rankLabelToNum(lab) {
      if (lab == null) return null;
      const n = RANK_LABEL_TO_N[String(lab)];
      return n == null ? null : n;
    }

    /** few = high-to-low rank labels e.g. ['A','K','Q','J'] → 'A-J口袋' or 'A口袋' */
    function formatPocketRangeChip(few) {
      if (!few || !few.length) return '口袋';
      if (few.length === 1) return few[0] + '口袋';
      return few[0] + '-' + few[few.length - 1] + '口袋';
    }

    /** Parse 'A口袋' / 'A-J口袋' / 'A-J' → { ranks:[14..], label } or null */
    function parsePocketChip(label) {
      if (!label) return null;
      const s = String(label).replace(/口袋$/, '');
      let m = s.match(/^([AKQJT2-9]|10)-([AKQJT2-9]|10)$/);
      if (m) {
        const hi = rankLabelToNum(m[1]);
        const lo = rankLabelToNum(m[2]);
        if (hi == null || lo == null || hi < lo) return null;
        const ranks = [];
        for (let r = hi; r >= lo; r--) ranks.push(r);
        return { ranks: ranks, raw: label };
      }
      m = s.match(/^([AKQJT2-9]|10)$/);
      if (m) {
        const r = rankLabelToNum(m[1]);
        if (r == null) return null;
        return { ranks: [r], raw: label };
      }
      return null;
    }

    /**
     * Collapse consecutive single-rank pocket chips into one 'A-J口袋' chip.
     * Non-pocket chips keep order; pocket groups insert where the first pocket was.
     */
    function mergeConsecutivePocketChips(chips) {
      if (!chips || !chips.length) return chips || [];
      const out = [];
      let pocketBuf = [];
      function flushPockets() {
        if (!pocketBuf.length) return;
        pocketBuf.sort(function (a, b) { return b - a; });
        const uniq = [];
        for (let i = 0; i < pocketBuf.length; i++) {
          if (uniq.indexOf(pocketBuf[i]) < 0) uniq.push(pocketBuf[i]);
        }
        uniq.sort(function (a, b) { return b - a; });
        let run = [uniq[0]];
        for (let i = 1; i < uniq.length; i++) {
          if (run[run.length - 1] - uniq[i] === 1) {
            run.push(uniq[i]);
          } else {
            out.push(formatPocketRangeChip(run.map(rankLabel)));
            run = [uniq[i]];
          }
        }
        out.push(formatPocketRangeChip(run.map(rankLabel)));
        pocketBuf = [];
      }
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i];
        const parsed = parsePocketChip(c);
        if (parsed && parsed.ranks.length === 1 && String(c).indexOf('-') < 0) {
          pocketBuf.push(parsed.ranks[0]);
        } else if (parsed && parsed.ranks.length > 1) {
          flushPockets();
          out.push(formatPocketRangeChip(parsed.ranks.map(rankLabel)));
        } else {
          flushPockets();
          out.push(c);
        }
      }
      flushPockets();
      return out;
    }

    /** Map beat chip label → { kind:'cat', cat } | { kind:'pocket', ranks } | null */
    function beatLabelKey(label) {
      if (!label) return null;
      const pocket = parsePocketChip(label);
      if (pocket) return { kind: 'pocket', ranks: pocket.ranks };
      const s = String(label);
      if (s.indexOf('同花顺') >= 0) return { kind: 'cat', cat: 8 };
      if (s.indexOf('四条') >= 0) return { kind: 'cat', cat: 7 };
      if (s.indexOf('葫芦') >= 0) return { kind: 'cat', cat: 6 };
      if (s.indexOf('同花') >= 0) return { kind: 'cat', cat: 5 };
      if (s.indexOf('顺') >= 0) return { kind: 'cat', cat: 4 };
      if (s.indexOf('暗三') >= 0 || s.indexOf('三条') >= 0) return { kind: 'cat', cat: 3 };
      if (s.indexOf('两对') >= 0) return { kind: 'cat', cat: 2 };
      if (s.indexOf('对') >= 0) return { kind: 'cat', cat: 1 };
      return null;
    }

    /** Approx P for a chip from MC beatCats/beatPockets (0–1). Pocket ranges: 1-Π(1-p). */
    function lookupBeatPct(label, beatProbs) {
      if (!beatProbs) return null;
      // Ghost guard: board/hero already ruled out higher two-pair.
      if (label && String(label).indexOf('更大两对') >= 0 && beatProbs.higherTwoPair === false) {
        return 0;
      }
      const key = beatLabelKey(label);
      if (!key) return null;
      if (key.kind === 'cat') {
        const p = beatProbs.cats && beatProbs.cats[key.cat];
        return p == null ? null : p;
      }
      const pockets = beatProbs.pockets || {};
      let pNone = 1;
      let any = false;
      for (let i = 0; i < key.ranks.length; i++) {
        const p = pockets[key.ranks[i]];
        if (p != null && p > 0) {
          any = true;
          pNone *= 1 - Math.min(1, p);
        }
      }
      if (!any) return 0;
      return Math.max(0, Math.min(1, 1 - pNone));
    }

    function fmtChipPct(p) {
      if (p == null || isNaN(p)) return '';
      if (p <= 0) return ' 0%';
      const pct = Math.round(100 * p);
      if (pct < 1) return ' <1%';
      return ' ' + pct + '%';
    }

    function levelTone(level) {
      if (level === 'danger') return { fg: '#ffe4de', accent: '#ff5c4d', bg: 'rgba(255,70,55,0.16)', chip: 'rgba(255,90,70,0.38)' };
      if (level === 'warn') return { fg: '#fff1c9', accent: '#ffc107', bg: 'rgba(255,180,40,0.14)', chip: 'rgba(255,193,7,0.32)' };
      return { fg: '#d6e8ff', accent: '#6eb6ff', bg: 'rgba(80,150,255,0.12)', chip: 'rgba(110,180,255,0.28)' };
    }

    function collectBeatChips(list) {
      const chips = [];
      const seen = {};
      let topLevel = 'info';
      const notes = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.kind !== 'beat') continue;
        if (a.level === 'danger') topLevel = 'danger';
        else if (a.level === 'warn' && topLevel !== 'danger') topLevel = 'warn';
        if (a.beats && a.beats.length) {
          for (let j = 0; j < a.beats.length; j++) {
            const c = a.beats[j];
            if (seen[c]) continue;
            seen[c] = true;
            chips.push(c);
          }
        }
        if (a.text) notes.push(a.text);
      }
      const merged = mergeConsecutivePocketChips(chips);
      return { chips: merged, topLevel: topLevel, notes: notes };
    }

    function renderBeatPanel(list, compact) {
      const beatItems = (list || []).filter(function (a) { return a && a.kind === 'beat'; });
      const otherItems = (list || []).filter(function (a) { return a && a.kind !== 'beat'; });
      let html = '';
      if (beatItems.length) {
        const pack = collectBeatChips(beatItems);
        const tone = levelTone(pack.topLevel);
        const probs = state.beatProbs || null;
        const chipHtml = (pack.chips.length ? pack.chips : pack.notes.slice(0, 6))
          .map(function (c) {
            const pctTxt = pack.chips.length ? fmtChipPct(lookupBeatPct(c, probs)) : '';
            return (
              '<span style="display:inline-block;padding:3px 7px;margin:2px 3px 2px 0;border-radius:999px;' +
              'background:' + tone.chip + ';color:#fff;font-weight:800;font-size:' + (compact ? '12px' : '11px') + ';' +
              'letter-spacing:.01em;line-height:1.2;box-shadow:0 0 0 1px rgba(255,255,255,.12);white-space:nowrap;">' +
              c + pctTxt +
              '</span>'
            );
          })
          .join('');
        const note = pack.notes.length
          ? '<div style="margin-top:4px;font-size:10px;opacity:.8;line-height:1.3;font-weight:600;">' +
            pack.notes.slice(0, compact ? 2 : 3).join(' · ') +
            '</div>'
          : '';
        html +=
          '<div style="padding:6px 8px;border-radius:9px;background:' + tone.bg + ';' +
          'border:1.5px solid ' + tone.accent + ';box-shadow:0 0 12px ' + tone.accent + '28 inset;">' +
          '<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">' +
          '<span style="font-size:' + (compact ? '12px' : '12px') + ';font-weight:900;color:' + tone.accent + ';letter-spacing:.03em;">⚠ 能压你</span>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;align-items:center;">' + chipHtml + '</div>' +
          note +
          '</div>';
      }
      for (let i = 0; i < otherItems.length; i++) {
        const a = otherItems[i];
        const tone = levelTone(a.level);
        html +=
          '<div style="font-size:11px;line-height:1.3;padding:4px 7px;border-radius:7px;background:' +
          tone.bg +
          ';color:' +
          tone.fg +
          ';border-left:3px solid ' +
          tone.accent +
          ';">' +
          a.text +
          '</div>';
      }
      return html;
    }

    function render() {

      ensureOverlay();
      const eq = equityValue();
      const eqTxt = fmtPct(eq);
      const tone = equityTone(eq);
      if (els.cEq) {
        els.cEq.textContent = state.hiLo && eqTxt !== '—' ? 'Hi ' + eqTxt : eqTxt;
        els.cEq.style.color = tone;
      }
      if (els.cDot) {
        els.cDot.style.background = tone;
        els.cDot.style.boxShadow = '0 0 8px ' + tone;
      }
      if (els.eqHero) {
        els.eqHero.textContent = state.hiLo && eqTxt !== '—' ? 'Hi ' + eqTxt : eqTxt;
        els.eqHero.style.color = tone;
      }
      const w = state.win == null || isNaN(state.win) ? 0 : Math.max(0, state.win);
      const t = state.tie == null || isNaN(state.tie) ? 0 : Math.max(0, state.tie);
      const l = state.lose == null || isNaN(state.lose) ? 0 : Math.max(0, state.lose);
      const sum = w + t + l;
      if (els.barWin && els.barTie && els.barLose) {
        if (sum > 0) {
          els.barWin.style.width = (100 * w) / sum + '%';
          els.barTie.style.width = (100 * t) / sum + '%';
          els.barLose.style.width = (100 * l) / sum + '%';
        } else {
          els.barWin.style.width = '0%';
          els.barTie.style.width = '0%';
          els.barLose.style.width = '0%';
        }
      }
      if (els.cMade) els.cMade.textContent = state.made || '—';
      if (els.cAlerts) {
        const list = state.alerts || [];
        const hasBeat = list.some(function (a) { return a && a.kind === 'beat'; });
        const showList = hasBeat ? list : list.slice(0, 3);
        if (!showList.length) {
          els.cAlerts.style.display = 'none';
          els.cAlerts.innerHTML = '';
        } else {
          els.cAlerts.style.display = 'flex';
          els.cAlerts.innerHTML = renderBeatPanel(showList, true);
        }
        // Danger beat tips: pulse the whole bar edge so it is hard to miss
        if (root) {
          const dangerBeat = list.some(function (a) { return a && a.kind === 'beat' && a.level === 'danger'; });
          const warnBeat = list.some(function (a) { return a && a.kind === 'beat' && a.level === 'warn'; });
          if (dangerBeat) {
            root.style.border = '2px solid rgba(255,80,60,0.85)';
            root.style.boxShadow = '0 0 16px rgba(255,70,50,0.28), 0 6px 18px rgba(0,0,0,0.22)';
          } else if (warnBeat) {
            root.style.border = '2px solid rgba(255,193,7,0.75)';
            root.style.boxShadow = '0 0 14px rgba(255,180,40,0.22), 0 6px 18px rgba(0,0,0,0.22)';
          } else {
            root.style.border = '1px solid rgba(255,255,255,0.12)';
            root.style.boxShadow = '0 6px 18px rgba(0,0,0,0.22)';
          }
        }
      }
      els.hand.textContent = fmtCards(state.hero);
      els.board.textContent = fmtCards(state.board);
      const vlab =
        state.variant === 'omaha-hl'
          ? 'Omaha Hi/Lo'
          : state.variant === 'omaha'
            ? 'Omaha'
            : '德州';
      els.opp.textContent = (state.opponents || '—') + ' · ' + vlab;
      if (els.cEqSub) {
        els.cEqSub.textContent =
          state.hiLo
            ? 'High 胜+平'
            : (isOmahaVariant(state.variant) ? vlab + ' · ' : '') + '胜+平';
      }
      if (els.cHiLo) {
        if (state.hiLo && state.lowWin != null) {
          const hiEq = (state.win || 0) + (state.tie || 0);
          const loEq = (state.lowWin || 0) + (state.lowTie || 0);
          els.cHiLo.style.display = 'block';
          els.cHiLo.textContent =
            'Lo ' +
            fmtPct(loEq) +
            (state.noLow != null ? ' · 无Low ' + fmtPct(state.noLow) : '') +
            (state.scoop != null ? ' · Scoop ' + fmtPct(state.scoop) : '');
        } else {
          els.cHiLo.style.display = 'none';
          els.cHiLo.textContent = '';
        }
      }
      if (els.hiLoBox) {
        if (state.hiLo && state.lowWin != null) {
          const hiEq = (state.win || 0) + (state.tie || 0);
          const loEq = (state.lowWin || 0) + (state.lowTie || 0);
          els.hiLoBox.style.display = 'block';
          if (els.hiLoHigh)
            els.hiLoHigh.textContent =
              'High ' +
              fmtPct(hiEq) +
              '（胜 ' +
              fmtPct(state.win) +
              ' · 平 ' +
              fmtPct(state.tie) +
              '）';
          if (els.hiLoLow)
            els.hiLoLow.textContent =
              'Low ' +
              fmtPct(loEq) +
              '（胜 ' +
              fmtPct(state.lowWin) +
              ' · 平 ' +
              fmtPct(state.lowTie) +
              ' · 无Low ' +
              fmtPct(state.noLow) +
              '）';
          if (els.hiLoScoop)
            els.hiLoScoop.textContent = 'Scoop ' + fmtPct(state.scoop) + '（通吃整池）';
        } else {
          els.hiLoBox.style.display = 'none';
        }
      }
      els.win.textContent = fmtPct(state.win);
      els.tie.textContent = fmtPct(state.tie);
      els.lose.textContent = fmtPct(state.lose);
      els.meta.textContent =
        fmtTime(state.lastUpdate) +
        ' · ' +
        (state.source || '—') +
        (state.trials ? ' · N=' + state.trials : '');
      els.status.textContent = state.status || '';
      if (els.madeLine) els.madeLine.textContent = '成牌：' + (state.made || '—');
      const potTip = state.potOddsHint;
      if (els.cPotOdds) {
        if (potTip && potTip.label) {
          els.cPotOdds.style.display = 'block';
          els.cPotOdds.textContent = potTip.label;
          if (potTip.ok === true) {
            els.cPotOdds.style.background = 'rgba(90,200,160,0.12)';
            els.cPotOdds.style.color = '#8fe3c0';
          } else if (potTip.ok === false) {
            els.cPotOdds.style.background = 'rgba(255,140,80,0.14)';
            els.cPotOdds.style.color = '#ffd0a8';
          } else {
            els.cPotOdds.style.background = 'rgba(120,160,255,0.10)';
            els.cPotOdds.style.color = '#a8c8ff';
          }
        } else {
          els.cPotOdds.style.display = 'none';
          els.cPotOdds.textContent = '';
        }
      }
      if (els.potOddsLine) {
        if (potTip && potTip.label) {
          els.potOddsLine.style.display = 'block';
          els.potOddsLine.textContent = potTip.label;
          if (potTip.ok === true) {
            els.potOddsLine.style.background = 'rgba(90,200,160,0.12)';
            els.potOddsLine.style.color = '#8fe3c0';
          } else if (potTip.ok === false) {
            els.potOddsLine.style.background = 'rgba(255,140,80,0.14)';
            els.potOddsLine.style.color = '#ffd0a8';
          } else {
            els.potOddsLine.style.background = 'rgba(120,160,255,0.10)';
            els.potOddsLine.style.color = '#a8c8ff';
          }
        } else {
          els.potOddsLine.style.display = 'none';
          els.potOddsLine.textContent = '';
        }
      }
      if (els.potOddsDetail) {
        if (potTip && potTip.detail) {
          els.potOddsDetail.style.display = 'block';
          els.potOddsDetail.textContent = potTip.detail;
        } else {
          els.potOddsDetail.style.display = 'none';
          els.potOddsDetail.textContent = '';
        }
      }
      const hint = state.betHint;
      if (els.cBet) {
        if (hint && hint.label && hint.label !== '—') {
          els.cBet.style.display = 'block';
          els.cBet.textContent = '建议：' + hint.label;
        } else {
          els.cBet.style.display = 'none';
          els.cBet.textContent = '';
        }
      }
      if (els.betLine) {
        els.betLine.textContent = '建议：' + (hint && hint.label ? hint.label : '—');
      }
      if (els.betDetail) {
        els.betDetail.textContent = hint && hint.detail ? hint.detail : '';
      }
      if (els.alerts) {
        const list = state.alerts || [];
        if (!list.length) {
          els.alerts.innerHTML = '<div style="font-size:10px;opacity:.45;">暂无特别提醒</div>';
        } else {
          els.alerts.innerHTML = renderBeatPanel(list, false);
        }
      }
      if (specialVisible) renderSpecial();
    }


    // ─── Special combinatorial panel (independent of equity bar) ─────────
    const SPECIAL_UI_KEY = 'rp-odds-special-v1';
    function loadSpecialPref() {
      try {
        return JSON.parse(localStorage.getItem(SPECIAL_UI_KEY) || '{}') || {};
      } catch (_) {
        return {};
      }
    }
    function saveSpecialPref(patch) {
      try {
        const cur = loadSpecialPref();
        Object.assign(cur, patch);
        localStorage.setItem(SPECIAL_UI_KEY, JSON.stringify(cur));
      } catch (_) {}
    }

    function comb(n, k) {
      if (k < 0 || k > n) return 0;
      if (k === 0 || k === n) return 1;
      if (k > n - k) k = n - k;
      let r = 1;
      for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
      return r;
    }

    /** Exact P(at least one of N players gets 2 suited), E, P(single). Flop 3-flush etc. */
    function flushTwoSuitedStats(suitedLeft, deckLeft, N) {
      const S = suitedLeft;
      const T = deckLeft;
      const U = T - S;
      const pSingle = S >= 2 && T >= 2 ? comb(S, 2) / comb(T, 2) : 0;
      const E = N * pSingle;
      // Probability DP: mass of deals with zero flush-completing (FF) players
      let dp = new Map();
      dp.set(0, 1);
      for (let i = 0; i < N; i++) {
        const rem = T - 2 * i;
        const den = comb(rem, 2);
        const next = new Map();
        if (den <= 0) {
          dp = next;
          break;
        }
        for (const entry of dp) {
          const s = entry[0];
          const p = entry[1];
          const remS = S - s;
          const remU = U - (2 * i - s);
          // FN (1 suited) — still no FF
          if (remS >= 1 && remU >= 1) {
            const pr = p * (remS * remU) / den;
            next.set(s + 1, (next.get(s + 1) || 0) + pr);
          }
          // NN (0 suited)
          if (remU >= 2) {
            const pr = p * comb(remU, 2) / den;
            next.set(s, (next.get(s) || 0) + pr);
          }
        }
        dp = next;
      }
      let pNo = 0;
      for (const p of dp.values()) pNo += p;
      if (pNo > 1) pNo = 1;
      if (pNo < 0) pNo = 0;
      return { pSingle: pSingle, pAtLeast: 1 - pNo, E: E };
    }

    /** Board 4-suited style: player needs ≥1 suited in 2 hole cards. */
    function flushOnePlusStats(suitedLeft, deckLeft, N) {
      const S = suitedLeft;
      const T = deckLeft;
      const U = T - S;
      const pSingle = T >= 2 ? 1 - comb(U, 2) / comb(T, 2) : 0;
      const E = N * pSingle;
      // P(all N have 0 suited) = sequential NN only
      let pAllNN = 1;
      for (let i = 0; i < N; i++) {
        const rem = T - 2 * i;
        const remU = U - 2 * i;
        if (rem < 2 || remU < 2) {
          pAllNN = 0;
          break;
        }
        pAllNN *= comb(remU, 2) / comb(rem, 2);
      }
      return { pSingle: pSingle, pAtLeast: 1 - pAllNN, E: E };
    }

    /**
     * Flop trips: 1 case card in deckLeft.
     * P(specific has case)=2/T; P(at least one of N)=2N/T (case equally likely among T spots).
     * At most one player can hold the case, so E = P(at least).
     * Prefer tripsCaseStatsGivenDeck (hero+board already removed) for UI lead %.
     */
    function tripsCaseStats(deckLeft, N) {
      const T = deckLeft;
      const pSingle = T > 0 ? 2 / T : 0;
      const pAtLeast = T > 0 ? Math.min(1, (2 * N) / T) : 0;
      return { pSingle: pSingle, pAtLeast: pAtLeast, E: pAtLeast };
    }

    /**
     * After board+hero removed: 1 case left in `deckLeft`, deal to `opp` opponents.
     * P(case among 2*opp hole cards) = 2*opp/deckLeft.
     */
    function tripsCaseStatsGivenDeck(deckLeft, opp, caseLeft) {
      const o = Math.max(0, opp | 0);
      const T = deckLeft;
      const c = caseLeft == null ? 1 : caseLeft;
      if (c <= 0 || T <= 0 || o <= 0) {
        return { pSingle: 0, pAtLeast: 0, E: 0 };
      }
      // Only well-defined for a single case card (usual flop-trips tip)
      if (c === 1) {
        const pSingle = 2 / T;
        const pAtLeast = Math.min(1, (2 * o) / T);
        return { pSingle: pSingle, pAtLeast: pAtLeast, E: pAtLeast };
      }
      // Multiple cases left: approx via sequential (rare for this panel)
      let pNone = 1;
      for (let i = 0; i < o; i++) {
        const rem = T - 2 * i;
        if (rem < 2) {
          pNone = 0;
          break;
        }
        pNone *= comb(rem - c, 2) / comb(rem, 2);
      }
      const pAtLeast = Math.max(0, Math.min(1, 1 - pNone));
      const pSingle = T >= 2 ? 1 - comb(T - c, 2) / comb(T, 2) : 0;
      return { pSingle: pSingle, pAtLeast: pAtLeast, E: o * pSingle };
    }

    /**
     * 3-flush style, conditioned on hero NOT holding 2 suited (practice fallback).
     * Mixture over hero NN / FN, then deal to opp = N-1.
     */
    function flushTwoSuitedStatsHeroMiss(suitedLeft, deckLeft, N) {
      const S = suitedLeft;
      const T = deckLeft;
      const U = T - S;
      const opp = Math.max(0, (N | 0) - 1);
      if (opp <= 0 || T < 4) {
        return { pSingle: 0, pAtLeast: 0, E: 0 };
      }
      const wNN = U >= 2 ? comb(U, 2) : 0;
      const wFN = S >= 1 && U >= 1 ? S * U : 0;
      const wTot = wNN + wFN;
      if (wTot <= 0) {
        return { pSingle: 0, pAtLeast: 0, E: 0 };
      }
      let pAtLeast = 0;
      let pSingle = 0;
      let E = 0;
      if (wNN > 0) {
        const st = flushTwoSuitedStats(S, T - 2, opp);
        const w = wNN / wTot;
        pAtLeast += w * st.pAtLeast;
        pSingle += w * st.pSingle;
        E += w * st.E;
      }
      if (wFN > 0) {
        const st = flushTwoSuitedStats(S - 1, T - 2, opp);
        const w = wFN / wTot;
        pAtLeast += w * st.pAtLeast;
        pSingle += w * st.pSingle;
        E += w * st.E;
      }
      return { pSingle: pSingle, pAtLeast: pAtLeast, E: E };
    }

    /**
     * 4-flush style, conditioned on hero holding 0 suited (practice fallback).
     */
    function flushOnePlusStatsHeroMiss(suitedLeft, deckLeft, N) {
      const S = suitedLeft;
      const T = deckLeft;
      const U = T - S;
      const opp = Math.max(0, (N | 0) - 1);
      if (opp <= 0 || T < 4 || U < 2) {
        return { pSingle: 0, pAtLeast: 0, E: 0 };
      }
      // Hero took 2 from unsuited → rem S unchanged, T-2, U-2
      return flushOnePlusStats(S, T - 2, opp);
    }

    /** Live equity-state cards for conditioning special probs. */
    function liveSpecialCards() {
      const heroCodes = (state.hero || []).map(normalizeCard).filter(Boolean);
      const boardCodes = (state.board || []).map(normalizeCard).filter(Boolean);
      const hero = heroCodes.map(parseCardObj).filter(Boolean);
      const board = boardCodes.map(parseCardObj).filter(Boolean);
      const knownHero = hero.length === 2 || hero.length === 4;
      const knownBoard = board.length >= 3;
      return {
        hero: hero,
        board: board,
        heroCodes: heroCodes,
        boardCodes: boardCodes,
        knownHero: knownHero,
        knownBoard: knownBoard,
      };
    }

    function maxSuitOnBoard(board) {
      const m = countSuits(board);
      let best = 's';
      let n = -1;
      const ks = ['s', 'h', 'd', 'c'];
      for (let i = 0; i < ks.length; i++) {
        if (m[ks[i]] > n) {
          n = m[ks[i]];
          best = ks[i];
        }
      }
      return { suit: best, count: n < 0 ? 0 : n };
    }

    function countHeroSuit(hero, suit) {
      let n = 0;
      for (let i = 0; i < hero.length; i++) {
        if (hero[i] && hero[i].suit === suit) n++;
      }
      return n;
    }

    function countHeroRank(hero, rank) {
      let n = 0;
      for (let i = 0; i < hero.length; i++) {
        if (hero[i] && hero[i].rank === rank) n++;
      }
      return n;
    }

    function fmtPct2(p) {
      if (p == null || isNaN(p)) return '—';
      return (100 * p).toFixed(2) + '%';
    }

    let specialRoot = null;
    let specialEls = {};
    let specialDrag = null;
    let specialVisible = false;

    function clampSpecialPos(left, top) {
      const w = (specialRoot && specialRoot.offsetWidth) || 220;
      const h = (specialRoot && specialRoot.offsetHeight) || 120;
      const maxL = Math.max(4, window.innerWidth - w - 4);
      const maxT = Math.max(4, window.innerHeight - h - 4);
      return {
        left: Math.min(maxL, Math.max(4, left)),
        top: Math.min(maxT, Math.max(4, top)),
      };
    }

    function applySpecialChrome() {
      if (!specialRoot) return;
      const pref = loadSpecialPref();
      Object.assign(specialRoot.style, {
        position: 'fixed',
        zIndex: '2147483645',
        width: 'auto',
        minWidth: '180px',
        maxWidth: 'min(280px, calc(100vw - 20px))',
        boxSizing: 'border-box',
        margin: '0',
        padding: '6px 8px 8px',
        color: '#e8eef7',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '12px',
        lineHeight: '1.35',
        pointerEvents: 'auto',
        userSelect: 'none',
        background: 'rgba(8, 12, 20, 0.48)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '12px',
        boxShadow: '0 8px 28px rgba(0,0,0,0.32)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: specialVisible ? 'flex' : 'none',
        flexDirection: 'column',
        gap: '6px',
        cursor: 'grab',
        overflow: 'hidden',
      });
      if (pref.left != null && pref.top != null) {
        const pos = clampSpecialPos(Number(pref.left), Number(pref.top));
        specialRoot.style.left = pos.left + 'px';
        specialRoot.style.top = pos.top + 'px';
        specialRoot.style.right = 'auto';
        specialRoot.style.bottom = 'auto';
        specialRoot.style.transform = 'none';
      } else {
        specialRoot.style.left = 'auto';
        specialRoot.style.right = '12px';
        specialRoot.style.top = '72px';
        specialRoot.style.bottom = 'auto';
        specialRoot.style.transform = 'none';
      }
    }

    function bindSpecialDrag() {
      if (!specialRoot || specialRoot.__rpDragBound) return;
      specialRoot.__rpDragBound = true;
      specialRoot.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;
        e.preventDefault();
        const rect = specialRoot.getBoundingClientRect();
        specialRoot.style.left = rect.left + 'px';
        specialRoot.style.top = rect.top + 'px';
        specialRoot.style.right = 'auto';
        specialRoot.style.transform = 'none';
        specialDrag = {
          ox: e.clientX - rect.left,
          oy: e.clientY - rect.top,
          moved: false,
        };
        specialRoot.style.cursor = 'grabbing';
        try {
          specialRoot.setPointerCapture(e.pointerId);
        } catch (_) {}
      });
      specialRoot.addEventListener('pointermove', function (e) {
        if (!specialDrag) return;
        specialDrag.moved = true;
        const pos = clampSpecialPos(e.clientX - specialDrag.ox, e.clientY - specialDrag.oy);
        specialRoot.style.left = pos.left + 'px';
        specialRoot.style.top = pos.top + 'px';
      });
      function endDrag(e) {
        if (!specialDrag) return;
        specialDrag = null;
        specialRoot.style.cursor = 'grab';
        const rect = specialRoot.getBoundingClientRect();
        const pos = clampSpecialPos(rect.left, rect.top);
        specialRoot.style.left = pos.left + 'px';
        specialRoot.style.top = pos.top + 'px';
        saveSpecialPref({ left: pos.left, top: pos.top });
        try {
          specialRoot.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
      specialRoot.addEventListener('pointerup', endDrag);
      specialRoot.addEventListener('pointercancel', endDrag);
    }

    /**
     * Auto special probs from live equity state only.
     * Opp count = state.opponents (locked at hand start).
     * Condition on hero+board when known; else assume hero misses the threat cards.
     * Only emit rows that match current board texture.
     */
    function computeSpecial() {
      const live = liveSpecialCards();
      const opp = Math.max(0, state.opponents | 0);
      const rows = [];

      if (!live.knownBoard) {
        return { rows: rows, empty: '等待牌面…' };
      }
      if (opp < 1) {
        return { rows: rows, empty: '对手数为 0' };
      }

      const board = live.board;
      const heroKnown = !!live.knownHero;
      const hero = heroKnown ? live.hero : [];
      const heroN = heroKnown ? live.hero.length : 0;
      const boardLen = board.length;
      const deckAfterBoard = 52 - boardLen;
      const T = deckAfterBoard - heroN;
      const ms = maxSuitOnBoard(board);
      const bp = boardPairInfo(board);

      // ── 3-suited board → opp needs 2 of that suit for flush ──
      if (ms.count === 3) {
        let st;
        if (heroKnown) {
          const heroSuited = countHeroSuit(hero, ms.suit);
          const S = Math.max(0, 13 - ms.count - heroSuited);
          st = flushTwoSuitedStats(S, Math.max(0, T), opp);
        } else {
          // Assume hero does not hold 2 suited; N = opp+1 total seats
          st = flushTwoSuitedStatsHeroMiss(13 - 3, deckAfterBoard, opp + 1);
        }
        rows.push({
          label: '对手至少1人成该花同花',
          pct: fmtPct2(st.pAtLeast),
        });
      }

      // ── 4-suited board → opp needs ≥1 of that suit ──
      if (ms.count === 4) {
        let st;
        if (heroKnown) {
          const heroSuited = countHeroSuit(hero, ms.suit);
          const S = Math.max(0, 13 - ms.count - heroSuited);
          st = flushOnePlusStats(S, Math.max(0, T), opp);
        } else {
          st = flushOnePlusStatsHeroMiss(13 - 4, deckAfterBoard, opp + 1);
        }
        rows.push({
          label: '对手至少1人有该花 (≥1)',
          pct: fmtPct2(st.pAtLeast),
        });
      }

      // 5-suited: board already flush — no hole-card threat row

      // ── Board trips → case card for quads ──
      if (bp.trips && !bp.quads) {
        let tripRank = null;
        const keys = Object.keys(bp.counts);
        for (let i = 0; i < keys.length; i++) {
          if (bp.counts[keys[i]] >= 3 && bp.counts[keys[i]] < 4) {
            tripRank = Number(keys[i]);
            break;
          }
        }
        const caseLeft = tripRank == null ? 1 : 4 - bp.counts[tripRank];
        let st;
        let deckForCase = T;
        if (!heroKnown) {
          // Assume hero does not hold the case: remove 2 non-case from deck
          deckForCase = deckAfterBoard - 2;
          st = tripsCaseStatsGivenDeck(deckForCase, opp, caseLeft);
        } else {
          const heroHasCase = tripRank != null && countHeroRank(hero, tripRank) > 0;
          if (heroHasCase || caseLeft <= 0) {
            st = { pSingle: 0, pAtLeast: 0, E: 0 };
          } else {
            st = tripsCaseStatsGivenDeck(deckForCase, opp, caseLeft);
          }
        }
        rows.push({
          label: '对手至少1人拿箱子成四条',
          pct: fmtPct2(st.pAtLeast),
        });

        // Turn/river can still bring the case onto the board
        if (caseLeft > 0 && boardLen < 5) {
          const streets = 5 - boardLen;
          let boardCaseP = null;
          const Td = heroKnown ? T : deckAfterBoard - 2;
          if (Td > 0) {
            if (streets === 1) boardCaseP = caseLeft / Td;
            else if (streets === 2 && Td >= 2) {
              boardCaseP = 1 - comb(Td - caseLeft, 2) / comb(Td, 2);
            }
          }
          if (boardCaseP != null) {
            rows.push({
              label: '转/河出箱子成四条',
              pct: fmtPct2(boardCaseP),
            });
          }
        }
      }

      if (!rows.length) {
        return { rows: rows, empty: '当前牌面无特殊威胁' };
      }
      return { rows: rows, empty: '' };
    }

    function renderSpecial() {
      if (!specialRoot || !specialVisible) return;
      const out = computeSpecial();
      if (!specialEls.results) return;
      if (!out.rows.length) {
        specialEls.results.innerHTML =
          '<div style="padding:10px 8px;opacity:.55;font-size:12px;text-align:center;">' +
          (out.empty || '—') +
          '</div>';
        return;
      }
      let html = '';
      for (let i = 0; i < out.rows.length; i++) {
        const r = out.rows[i];
        html +=
          '<div style="padding:7px 8px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);">' +
          '<div style="font-size:22px;font-weight:750;font-variant-numeric:tabular-nums;color:#7ec8ff;letter-spacing:.01em;line-height:1.05;">' +
          r.pct +
          '</div>' +
          '<div style="margin-top:4px;font-size:12px;opacity:.78;">' +
          r.label +
          '</div></div>';
      }
      specialEls.results.innerHTML = html;
    }

    function setSpecialVisible(v) {
      specialVisible = !!v;
      saveSpecialPref({ visible: specialVisible });
      applySpecialChrome();
      if (specialVisible) renderSpecial();
    }

    function toggleSpecialPanel() {
      ensureSpecialPanel();
      setSpecialVisible(!specialVisible);
    }

    function ensureSpecialPanel() {
      if (specialRoot && document.body.contains(specialRoot)) {
        applySpecialChrome();
        return;
      }
      const pref = loadSpecialPref();
      specialVisible = !!pref.visible;

      specialRoot = document.createElement('div');
      specialRoot.id = 'rp-odds-special';
      specialRoot.setAttribute('data-rp-odds-special', '1');
      specialRoot.setAttribute('aria-label', '特殊概率');

      specialRoot.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<div style="font-weight:700;font-size:12px;letter-spacing:.02em;">特殊</div>' +
        '<button type="button" data-act="sp-close" title="关闭" style="cursor:pointer;border:0;background:transparent;color:#9aa8bc;font-size:14px;padding:2px 6px;line-height:1;">×</button>' +
        '</div>' +
        '<div data-k="sp-results" style="display:flex;flex-direction:column;gap:6px;"></div>';

      specialEls = {
        results: specialRoot.querySelector('[data-k="sp-results"]'),
      };

      specialRoot.querySelector('[data-act="sp-close"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setSpecialVisible(false);
      });

      applySpecialChrome();
      bindSpecialDrag();
      (document.body || document.documentElement).appendChild(specialRoot);
      if (specialVisible) renderSpecial();
    }


    function bootOverlay() {
      if (!document.body) {
        setTimeout(bootOverlay, 50);
        return;
      }
      teardownDockHacks();
      ensureOverlay();
      ensureSpecialPanel();
      bindDomObserver();
      render();
      // Mid-hand / SPA: console Hole/Community already fired — scrape DOM now.
      try {
        pollDom();
      } catch (_) {}
      try {
        const need = isOmahaVariant(state.variant) ? 4 : 2;
        if (
          !state.computing &&
          state.win == null &&
          state.hero.length >= need &&
          state.opponents >= 1
        ) {
          scheduleCompute('启动补算');
        }
      } catch (_) {}
    }
    bootOverlay();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        bindDomObserver();
        try {
          pollDom();
        } catch (_) {}
      });
    }

    // Self-check evaluator once (dev aid, silent unless mismatch)
    try {
      const wheel = ['As', '2d', '3c', '4h', '5s'].map(parseCardObj);
      const sc = evaluate5(wheel);
      if (!sc || sc[0] !== 4 || sc[1] !== 5) {
        state.status = '警告：轮子顺子自检失败';
        render();
      }
    } catch (_) {}
})();
