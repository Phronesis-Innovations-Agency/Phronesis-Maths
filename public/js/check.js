// Marks a short typed answer. Shared by the learner app (browser) and the tests (Node).
(function (root) {
  var VULGAR = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8' };

  function clean(s) {
    s = String(s == null ? '' : s).toLowerCase().trim();
    s = s.replace(/[₀-₉]+/g, '');                    // 1101₂ -> 1101 (the subscript only names the base)
    s = s.replace(/°\s*c\b/g, '');                   // 4 °C -> 4
    s = s.replace(/[¼½¾⅓⅔⅛]/g, function (c) { return VULGAR[c]; });
    s = s.replace(/[−–—]/g, '-');                    // unicode minus and dashes
    s = s.replace(/×/g, '*').replace(/÷/g, '/');
    s = s.replace(/^[a-z]\s*=\s*/, '');              // "x = 8" -> "8"
    s = s.replace(/\b(ugx|ushs|shs|sh|shillings?|degrees?|units?|litres?|liters?|km|cm|kg|g|days?|learners?|people)\b\.?/g, '');
    s = s.replace(/[°%]/g, '');
    while (/(\d),(\d{3})(?!\d)/.test(s)) s = s.replace(/(\d),(\d{3})(?!\d)/, '$1$2'); // 23,000 -> 23000
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  // Numbers: 12, -6, 6.5, 3/4, "4 1/4", "-1 1/2"
  function toNumber(s) {
    var m;
    if (/^-?\d+(\.\d+)?$/.test(s) || /^-?\.\d+$/.test(s)) return parseFloat(s);
    if ((m = s.match(/^(-?\d+)\s*\/\s*(\d+)$/))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
    if ((m = s.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) {
      if (!Number(m[4])) return null;
      var v = Number(m[2]) + Number(m[3]) / Number(m[4]);
      return m[1] ? -v : v;
    }
    return null;
  }

  function squash(s) {
    return s.replace(/[\s()]/g, '');
  }

  function isCorrect(given, accepted) {
    var g = clean(given);
    if (!g) return false;
    var gn = toNumber(g);
    return String(accepted).split('|').some(function (a) {
      var c = clean(a);
      if (squash(c) === squash(g)) return true;
      var an = toNumber(c);
      return an !== null && gn !== null && Math.abs(an - gn) < 1e-9;
    });
  }

  var api = { isCorrect: isCorrect, clean: clean, toNumber: toNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnswerCheck = api;
})(this);
