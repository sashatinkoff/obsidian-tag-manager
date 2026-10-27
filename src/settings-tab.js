"use strict";
/** Вкладка настроек плагина. */
const { Notice, PluginSettingTab, Setting } = require("obsidian");
const { clampNumber } = require("./utils.js");

class TagAuditorSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Tag Refactor & Auditor" });
        containerEl.createEl("p", { text: "Настройки сканирования и предпросмотра тегов." });
        new Setting(containerEl)
            .setName("Длина предпросмотра")
            .setDesc("Количество символов в выдержке заметки.")
            .addText((text) => text
            .setPlaceholder("400")
            .setValue(String(this.plugin.settings.previewChars))
            .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed))
                return;
            this.plugin.settings.previewChars = clampNumber(parsed, 80, 1200, 400);
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("YAML-атрибут даты создания заметки")
            .setDesc("Имя поля YAML, например created или Дата. Поддерживаются ISO, числовые даты и названия месяцев на разных языках (например, 12 октября 2012). Если поле указано, заметки без корректной даты идут в конец; если поле пустое, используется дата файла (см. ниже).")
            .addText((text) => text
            .setPlaceholder("created")
            .setValue(this.plugin.settings.createdDateProperty)
            .onChange(async (value) => {
            this.plugin.settings.createdDateProperty = value.trim();
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("Дата файла, если YAML-атрибут не задан")
            .setDesc("Syncthing и копирование файлов часто сбрасывают дату создания файла на дату синхронизации; в этом случае лучше указать YAML-атрибут выше.")
            .addDropdown((dropdown) => dropdown
            .addOption("ctime", "Дата создания файла")
            .addOption("mtime", "Дата изменения файла")
            .setValue(this.plugin.settings.fileDateField ?? "ctime")
            .onChange(async (value) => {
            this.plugin.settings.fileDateField = value === "mtime" ? "mtime" : "ctime";
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("Учитывать регистр")
            .setDesc("При включении #Project и #project считаются разными тегами.")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.caseSensitive)
            .onChange(async (value) => {
            this.plugin.settings.caseSensitive = value;
            // Queued operations are keyed by the old case mode; keeping them
            // could apply a change to the wrong set of tags.
            if (this.plugin.getPendingChanges().length > 0) {
                this.plugin.clearChanges();
                new Notice("Очередь изменений очищена: режим учёта регистра изменился.");
            }
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("Игнорируемые папки")
            .setDesc("Пути относительно корня хранилища, по одному на строку. В эти папки плагин не будет заходить при сканировании.")
            .addTextArea((text) => {
            text
                .setPlaceholder("Templates\nArchive")
                .setValue(this.plugin.settings.ignoredFolders.join("\n"));
            text.inputEl.rows = 5;
            text.inputEl.addClass("tra-settings-textarea");
            text.onChange(async (value) => {
                this.plugin.settings.ignoredFolders = value
                    .split(/\r?\n/)
                    .map((path) => path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
                    .filter(Boolean);
                await this.plugin.saveSettings();
            });
        });
        containerEl.createEl("p", {
            cls: "tra-settings-note",
            text: "Пакетное применение сохраняет формат YAML и кодовые блоки. Последнюю операцию можно отменить, если файлы после неё не менялись.",
        });
    }
}

module.exports = { TagAuditorSettingTab };
