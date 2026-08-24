"use strict";


var { aggregateAll, PROVIDERS } = require("./aggregator.js");

try {
  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.on("unhandledRejection", function (reason) {
      try {
        console.warn("[NuvioAggregator] Unhandled rejection:", String(reason));
      } catch (_) {}
    });
    process.on("uncaughtException", function (err) {
      try {
        console.warn("[NuvioAggregator] Uncaught exception:", String(err));
      } catch (_) {}
    });
  }
} catch (_) {}

module.exports = { aggregateAll: aggregateAll, PROVIDERS: PROVIDERS };
