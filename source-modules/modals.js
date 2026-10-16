import * as obsidian_1 from "obsidian";
import * as utils_1 from "./utils.js";
class ApplyConfirmModal extends obsidian_1.Modal {
    constructor(app, changes, affectedCount, mergedTargets, onConfirm) {
        super(app);
        this.changes = changes;
        this.affectedCount = affectedCount;
        this.mergedTargets = mergedTargets;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-modal-icon" });
        (0, obsidian_1.setIcon)(icon, "shield-check");
        contentEl.createEl("h2", { text: "Применить изменения?" });
        contentEl.createEl("p", { text: `Будет обработано ${this.affectedCount} ${(0, utils_1.pluralRu)(this.affectedCount, "заметка", "заметки", "заметок")} и применено ${this.changes.length} ${(0, utils_1.pluralRu)(this.changes.length, "переименование", "переименования", "переименований")}.` });
        const changes = contentEl.createDiv({ cls: "tra-modal-changes" });
        for (const change of this.changes) {
            const row = changes.createDiv({ cls: "tra-modal-change" });
            row.createSpan({ text: `#${change.oldTag}` });
            const arrow = row.createSpan({ cls: "tra-modal-arrow" });
            (0, obsidian_1.setIcon)(arrow, "arrow-right");
            row.createSpan({ text: `#${change.newTag}` });
        }
        if (this.mergedTargets.length > 0) {
            const warning = contentEl.createDiv({ cls: "tra-modal-warning" });
            const warningIcon = warning.createDiv();
            (0, obsidian_1.setIcon)(warningIcon, "alert-triangle");
            const warningText = warning.createDiv();
            warningText.createEl("strong", { text: "Возможное объединение тегов" });
            warningText.createEl("p", { text: `Следующие целевые теги уже существуют или повторяются в очереди: ${this.mergedTargets.map((tag) => `#${tag}`).join(", ")}. Это объединит их статистику.` });
        }
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        const cancel = actions.createEl("button", { cls: "tra-secondary-button", text: "Отмена" });
        cancel.addEventListener("click", () => this.close());
        const confirm = actions.createEl("button", { cls: "tra-primary-button", text: "Применить изменения" });
        confirm.addEventListener("click", async () => {
            confirm.disabled = true;
            confirm.setText("Обработка…");
            try {
                await this.onConfirm();
                this.close();
            }
            catch (error) {
                new obsidian_1.Notice(`Не удалось применить изменения: ${error instanceof Error ? error.message : String(error)}`, 8000);
                confirm.disabled = false;
                confirm.setText("Повторить");
            }
        });
    }
    onClose() {
        this.contentEl.empty();
    }
}
class BatchReportModal extends obsidian_1.Modal {
    constructor(app, plugin, report, isUndoReport = false) {
        super(app);
        this.plugin = plugin;
        this.report = report;
        this.isUndoReport = isUndoReport;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-report-icon" });
        (0, obsidian_1.setIcon)(icon, this.isUndoReport ? "history" : this.report.errors.length > 0 ? "alert-circle" : "check-circle-2");
        contentEl.createEl("h2", { text: this.isUndoReport ? "Отмена завершена" : "Результат рефакторинга" });
        const stats = contentEl.createDiv({ cls: "tra-report-stats" });
        this.createReportStat(stats, "Изменено", String(this.report.updatedFiles), "check");
        this.createReportStat(stats, this.isUndoReport ? "Пропущено" : "Без изменений", String(this.report.unchangedFiles), "minus");
        this.createReportStat(stats, "Ошибки", String(this.report.errors.length), "alert-triangle");
        if (!this.isUndoReport && this.report.mergedTargets.length > 0) {
            contentEl.createEl("p", { cls: "tra-report-note", text: `Объединённые цели: ${this.report.mergedTargets.map((tag) => `#${tag}`).join(", ")}` });
        }
        if (this.report.errors.length > 0) {
            const errorList = contentEl.createDiv({ cls: "tra-error-list" });
            errorList.createEl("strong", { text: "Файлы с ошибками" });
            for (const error of this.report.errors)
                errorList.createEl("div", { text: error });
        }
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        if (!this.isUndoReport && this.plugin.lastUndo.size > 0) {
            const undo = actions.createEl("button", { cls: "tra-secondary-button", text: "Отменить операцию" });
            undo.addEventListener("click", () => {
                this.close();
                void this.plugin.undoLastBatch();
            });
        }
        const close = actions.createEl("button", { cls: "tra-primary-button", text: "Готово" });
        close.addEventListener("click", () => this.close());
    }
    createReportStat(parent, label, value, iconName) {
        const item = parent.createDiv({ cls: "tra-report-stat" });
        const icon = item.createDiv();
        (0, obsidian_1.setIcon)(icon, iconName);
        item.createDiv({ cls: "tra-report-value", text: value });
        item.createDiv({ cls: "tra-report-label", text: label });
    }
    onClose() {
        this.contentEl.empty();
    }
}

export { ApplyConfirmModal, BatchReportModal };
