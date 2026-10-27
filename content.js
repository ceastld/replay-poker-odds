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
     * Returns { win, tie, lose, trials } as percentages 0–100.
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
        for (let o = 0; o < nOpp; o++) {
          const o1 = pool[p++];
          const o2 = pool[p++];
          const oppScore = evaluate7([o1, o2, fullBoard[0], fullBoard[1], fullBoard[2], fullBoard[3], fullBoard[4]]);
          const cmp = compareScores(oppScore, heroScore);
          if (cmp > 0) {
            beaten = true;
            break;
          }
          if (cmp === 0) tied = true;
        }
        if (beaten) losses++;
        else if (tied) ties++;
        else wins++;
      }

      const tot = wins + ties + losses;
      return {
        win: (100 * wins) / tot,
        tie: (100 * ties) / tot,
        lose: (100 * losses) / tot,
        trials: tot,
      };
    }

    // Expose tiny self-test helper (optional, console)
    window.__RP_ODDS_EVAL__ = { evaluate5, evaluate7, monteCarlo, normalizeCard, parseCardObj };

    // ─── Game state ─────────────────────────────────────────────────────
    const state = {
      hero: [],
      board: [],
      opponents: 0,
      source: '—',
      status: '等待发牌…',
      win: null,
      tie: null,
      lose: null,
      trials: 0,
      lastUpdate: null,
      computing: false,
      oppManualThisHand: false,
    };

    let computeToken = 0;
    const DEFAULT_TRIALS = 10000;
    let lastDomHeroKey = '';
    let lastDomBoardKey = '';
    let domMissLogged = false;

    function cardsKey(arr) {
      return (arr || []).join(',');
    }

    function scheduleCompute(reason) {
      if (state.hero.length !== 2) {
        state.win = state.tie = state.lose = null;
        state.status = state.hero.length ? '手牌不完整' : '等待手牌…';
        render();
        return;
      }
      if (state.opponents < 1) {
        state.status = '对手数为 0';
        render();
        return;
      }
      const token = ++computeToken;
      state.computing = true;
      state.status = '计算中… (' + reason + ')';
      render();

      // Yield so overlay paints, then run MC (chunked lightly)
      setTimeout(function () {
        if (token !== computeToken) return;
        try {
          const res = monteCarlo(state.hero, state.board, state.opponents, DEFAULT_TRIALS);
          if (token !== computeToken) return;
          if (!res) {
            state.status = '无法计算（牌面冲突？）';
            state.computing = false;
            render();
            return;
          }
          state.win = res.win;
          state.tie = res.tie;
          state.lose = res.lose;
          state.trials = res.trials;
          state.lastUpdate = new Date();
          state.computing = false;
          state.status = '就绪';
          render();
        } catch (err) {
          state.computing = false;
          state.status = '计算错误: ' + (err && err.message ? err.message : String(err));
          render();
        }
      }, 16);
    }

    function resetHand() {
      state.hero = [];
      state.board = [];
      state.opponents = 0;
      state.win = state.tie = state.lose = null;
      state.trials = 0;
      state.status = '新手牌…';
      state.oppManualThisHand = false;
      lastDomHeroKey = '';
      lastDomBoardKey = '';
      domMissLogged = false;
    }

    function setHeroFromPlayers(playerHands) {
      if (!Array.isArray(playerHands)) return false;
      state.opponents = Math.max(0, playerHands.length - 1);
      let hero = null;
      for (let i = 0; i < playerHands.length; i++) {
        const p = playerHands[i];
        const cards = (p && p.cards) || p;
        if (!Array.isArray(cards) || cards.length < 2) continue;
        const c0 = normalizeCard(cards[0]);
        const c1 = normalizeCard(cards[1]);
        if (c0 && c1) {
          hero = [c0, c1];
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
      const nodes = document.querySelectorAll(
        '.Cards__holeCards.Cards--mine .Card.Card--withValue, .Cards__holeCards.Cards--mine .Card--withValue'
      );
      return readCardsFromNodeList(nodes);
    }

    function scrapeBoardDom() {
      const nodes = document.querySelectorAll(
        '.Cards__communityCards .Card.Card--withValue, .Cards__communityCards .Card--withValue'
      );
      return readCardsFromNodeList(nodes);
    }

    function estimateOpponentsDom() {
      let n = document.querySelectorAll(
        '.Cards__holeCards.Cards--shown:not(.Cards--mine):not(.Cards--folded):not(.Cards--mucked)'
      ).length;
      if (n < 1) {
        n = document.querySelectorAll(
          '.Cards__holeCards.Cards--shown:not(.Cards--mine)'
        ).length;
      }
      return n;
    }

    function pollDom() {
      try {
        if (
          !document.querySelector('.Cards__holeCards, .Cards__communityCards, .Card.Card--withValue, .Game--holdem')
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

        // Hero: prefer console; only set from DOM when console has not claimed hero
        if (state.source === 'console' && state.hero.length === 2) {
          // keep console hero
        } else if (heroCodes.length >= 2) {
          const hero = heroCodes.slice(0, 2);
          const hk = cardsKey(hero);
          if (hk !== lastDomHeroKey || state.hero.length !== 2 || cardsKey(state.hero) !== hk) {
            lastDomHeroKey = hk;
            state.hero = hero;
            if (state.source !== 'console') state.source = 'dom';
            usedDomHero = true;
            changed = true;

            // Opponent estimate on hole deal
            const oppEst = estimateOpponentsDom();
            if (oppEst >= 1) {
              if (!state.oppManualThisHand || oppEst > state.opponents) {
                // If user already folded-1, only raise if DOM count is higher
                if (state.oppManualThisHand) {
                  if (oppEst > state.opponents) state.opponents = oppEst;
                } else {
                  state.opponents = oppEst;
                }
              }
            } else if (state.opponents < 1) {
              state.opponents = 1;
            }
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
          scheduleCompute(usedDomHero ? 'DOM手牌' : 'DOM公共牌');
        } else if (suitOnly && state.source !== 'console' && state.hero.length < 2) {
          state.status = 'DOM 仅花色可读，等 console 补点数';
          render();
        }
      } catch (_) {}
    }

    setInterval(pollDom, 1200);

    // ─── Overlay UI ─────────────────────────────────────────────────────
    function fmtPct(v) {
      if (v == null || isNaN(v)) return '—';
      return (Math.round(v * 100) / 100).toFixed(2) + '%';
    }
    function fmtCards(arr) {
      return arr && arr.length ? arr.join(' ') : '—';
    }
    function fmtTime(d) {
      if (!d) return '—';
      const pad = function (n) {
        return n < 10 ? '0' + n : '' + n;
      };
      return (
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds())
      );
    }

    let root = null;
    let els = {};

    function ensureOverlay() {
      if (root && document.body.contains(root)) return;
      root = document.createElement('div');
      root.id = 'rp-odds-overlay';
      root.setAttribute('data-rp-odds', '1');
      Object.assign(root.style, {
        position: 'fixed',
        top: '12px',
        left: '12px',
        zIndex: '2147483646',
        background: 'rgba(12, 16, 24, 0.82)',
        color: '#e8eef7',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '13px',
        lineHeight: '1.45',
        padding: '12px 14px',
        borderRadius: '10px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        minWidth: '220px',
        maxWidth: '300px',
        pointerEvents: 'auto',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255,255,255,0.08)',
        userSelect: 'none',
      });

      root.innerHTML =
        '<div style="font-weight:700;margin-bottom:6px;font-size:14px;">Replay 胜率 <span style="font-weight:400;opacity:.7;font-size:11px;">免费练习</span></div>' +
        '<div data-k="hand">手牌：—</div>' +
        '<div data-k="board">公共牌：—</div>' +
        '<div data-k="opp">对手数：—</div>' +
        '<div data-k="win" style="color:#3dde7a;">胜率：—</div>' +
        '<div data-k="tie" style="color:#f0c04e;">平局：—</div>' +
        '<div data-k="lose" style="color:#ff6b6b;">败率：—</div>' +
        '<div data-k="meta" style="opacity:.65;font-size:11px;margin-top:4px;">更新：— · 来源：—</div>' +
        '<div data-k="status" style="opacity:.8;font-size:11px;margin-top:2px;"></div>' +
        '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">' +
        '<button type="button" data-act="fold" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;background:linear-gradient(180deg,#f17254,#cf4221);color:#fff;font-size:12px;">对手弃牌 -1</button>' +
        '<button type="button" data-act="recalc" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;background:#2a3548;color:#fff;font-size:12px;">重算</button>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:10px;opacity:.55;">不代打 · 绝不点击 Fold/Call/Raise</div>';

      els = {
        hand: root.querySelector('[data-k="hand"]'),
        board: root.querySelector('[data-k="board"]'),
        opp: root.querySelector('[data-k="opp"]'),
        win: root.querySelector('[data-k="win"]'),
        tie: root.querySelector('[data-k="tie"]'),
        lose: root.querySelector('[data-k="lose"]'),
        meta: root.querySelector('[data-k="meta"]'),
        status: root.querySelector('[data-k="status"]'),
      };

      root.querySelector('[data-act="fold"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (state.opponents > 1) {
          state.opponents--;
          state.oppManualThisHand = true;
          scheduleCompute('弃牌-1');
        } else {
          state.status = '对手数已是最小值 1';
          render();
        }
      });
      root.querySelector('[data-act="recalc"]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        scheduleCompute('手动重算');
      });

      // Keep pointer-events only on panel: page elsewhere untouched
      (document.body || document.documentElement).appendChild(root);
    }

    function render() {
      ensureOverlay();
      els.hand.textContent = '手牌：' + fmtCards(state.hero);
      els.board.textContent = '公共牌：' + fmtCards(state.board);
      els.opp.textContent = '对手数：' + (state.opponents || '—');
      els.win.textContent = '胜率：' + fmtPct(state.win);
      els.tie.textContent = '平局：' + fmtPct(state.tie);
      els.lose.textContent = '败率：' + fmtPct(state.lose);
      els.meta.textContent =
        '更新：' +
        fmtTime(state.lastUpdate) +
        ' · 来源：' +
        state.source +
        (state.trials ? ' · N=' + state.trials : '');
      els.status.textContent = state.status || '';
    }

    function bootOverlay() {
      if (!document.body) {
        setTimeout(bootOverlay, 50);
        return;
      }
      ensureOverlay();
      render();
    }
    bootOverlay();

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
