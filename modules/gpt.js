const gpt4all = require("gpt4all");
const path = require("path");
const os = require("os");

class GPTModelManager {
    constructor(modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf") {
        this.modelName = modelName;
        this.model = null;
        this.modelDir = path.join(os.homedir(), ".cache", "gpt4all");
    }

    async init() {
        try {
            console.log("🚀 Инициализация GPT4All модели...");
            this.model = await gpt4all.loadModel(this.modelName);
            console.log("✅ Модель успешно инициализирована");
            return this;
        } catch (error) {
            console.error("❌ Ошибка инициализации модели:", error);
            return null;
        }
    }

    async generate(prompt, options = {}) {
        if (!this.model) {
            console.error("❌ Модель не инициализирована");
            return null;
        }

        try {
            const result = await this.model.generate(prompt, options);
            return result.text;
        } catch (error) {
            console.error("❌ Ошибка генерации:", error);
            return null;
        }
    }
}

module.exports = new GPTModelManager();
