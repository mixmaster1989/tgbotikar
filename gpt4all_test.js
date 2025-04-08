const { loadModel } = require("gpt4all");

async function getGpt4All() {
  try {
    const model = await loadModel("mistral-7b-instruct-v0.1.Q4_0.gguf", {
      device: "cpu",
      nCtx: 2048,
      verbose: true,
    });

    return model;
  } catch (err) {
    console.error("Ошибка в getGpt4All функции:", err);
  }
}

module.exports = getGpt4All;
