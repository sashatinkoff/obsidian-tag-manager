"use strict";
/** Сборка класса плагина из миксинов; вызывается загрузчиком в корневом main.js. */
const { BatchMixin } = require("./plugin/batch.js");
const { PluginCoreMixin } = require("./plugin/core.js");
const { QueueMixin } = require("./plugin/queue.js");
const { applyMixins } = require("./utils.js");

function installPlugin(PluginClass) {
    applyMixins(PluginClass, PluginCoreMixin, QueueMixin, BatchMixin);
}

module.exports = { installPlugin };
