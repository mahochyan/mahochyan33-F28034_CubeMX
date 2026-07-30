/* Deterministic JSON helpers shared by browser runtime and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeterministicJSON = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function sortValue(value) {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = sortValue(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  function stringify(value, space = 2) {
    return JSON.stringify(sortValue(value), null, space);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  return { sortValue, stringify, clone };
});
