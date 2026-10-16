import * as obsidian_1 from "obsidian";
import * as utils_1 from "./utils.js";
class TagAuditorSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Tag Refactor & Auditor" });
        containerEl.createEl("p", { text: "Настройки сканирования и предпросмотра тегов." });
        new obsidian_1.Setting(containerEl)
            .setName("Длина предпросмотра")
            .setDesc("Количество символов в выдержке заметки.")
            .addText((text) => text
            .setPlaceholder("400")
            .setValue(String(this.plugin.settings.previewChars))
            .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed))
                return;
            this.plugin.settings.previewChars = (0, utils_1.clampNumber)(parsed, 80, 1200, 400);
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Учитывать регистр")
            .setDesc("При включении #Project и #project считаются разными тегами.")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.caseSensitive)
            .onChange(async (value) => {
            this.plugin.settings.caseSensitive = value;
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
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

export { TagAuditorSettingTab };
