"use strict";
/** Подтверждение массовой операции на вкладке «Заметки по датам» с выбором заметок и предпросмотром изменений. */
const { Modal, Notice, setIcon } = require("obsidian");
const { pluralRu } = require("../utils.js");
const { FileReviewList } = require("./file-review-list.js");

class BulkApplyConfirmModal extends Modal {
    /**
     * @param options.files        выбранные заметки
     * @param options.title        название операции
     * @param options.details      описание операции
     * @param options.isDestructive показывать предупреждение
     * @param options.transform    (file, content) => content — для предпросмотра
     * @param options.onConfirm    async (selectedFiles) => void
     */
    constructor(app, plugin, options) {
        super(app);
        this.plugin = plugin;
        this.options = options;
    }
    onOpen() {
        const { contentEl } = this;
        const { files, title, details, isDestructive, transform } = this.options;
        this.modalEl?.addClass?.("tra-apply-modal");
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-modal-icon" });
        setIcon(icon, isDestructive ? "alert-triangle" : "layers");
        contentEl.createEl("h2", { text: "Применить массовые изменения?" });
        contentEl.createEl("p", { text: `Выбрано ${files.length} ${pluralRu(files.length, "заметка", "заметки", "заметок")}. Здесь можно ещё раз сузить выбор и посмотреть изменения в каждой заметке.` });
        const summary = contentEl.createDiv({ cls: "tra-bulk-confirm-summary" });
        summary.createEl("strong", { text: title });
        summary.createEl("p", { text: details });
        if (isDestructive) {
            const warning = contentEl.createDiv({ cls: "tra-modal-warning" });
            setIcon(warning.createDiv(), "alert-triangle");
            warning.createDiv({ text: "Будут изменены только выбранные заметки. После применения пакет можно отменить, если файлы не изменились повторно." });
        }
        this.review = new FileReviewList(this.app, this.plugin, {
            files,
            preview: (file) => this.plugin.previewTransform(file, transform),
            chipTags: (file) => this.plugin.getTagsForFile(file),
            onChange: () => this.syncConfirm(),
        });
        this.review.render(contentEl);
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        const cancel = actions.createEl("button", { cls: "tra-secondary-button", text: "Отмена", attr: { type: "button" } });
        cancel.addEventListener("click", () => this.close());
        const confirm = actions.createEl("button", { cls: "tra-primary-button tra-apply-confirm", attr: { type: "button" } });
        this.confirmButton = confirm;
        confirm.addEventListener("click", async () => {
            const selected = files.filter((file) => this.review.selectedPaths.has(file.path));
            if (selected.length === 0)
                return;
            confirm.disabled = true;
            confirm.setText("Обработка…");
            try {
                await this.options.onConfirm(selected);
                this.close();
            }
            catch (error) {
                new Notice(`Не удалось применить массовые изменения: ${error instanceof Error ? error.message : String(error)}`, 8000);
                confirm.disabled = false;
                confirm.setText("Повторить");
            }
        });
        this.syncConfirm();
    }
    syncConfirm() {
        const confirm = this.confirmButton;
        if (!confirm || !this.review || confirm.textContent === "Обработка…")
            return;
        const selected = this.review.selectedPaths.size;
        const total = this.options.files.length;
        confirm.disabled = selected === 0;
        confirm.setText(selected === total
            ? "Применить ко всем"
            : `Применить к ${selected} ${pluralRu(selected, "заметке", "заметкам", "заметкам")}`);
    }
    onClose() {
        this.contentEl.empty();
    }
}

module.exports = { BulkApplyConfirmModal };
