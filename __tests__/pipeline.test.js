// Проверяем наличие модуля pipeline
const path = require('path');
const fs = require('fs');

describe("Pipeline Tests", () => {
  const pipelinePath = path.join(__dirname, '../modules/ocr/pipeline.js');
  
  test('pipeline module should exist', () => {
    const fileExists = fs.existsSync(pipelinePath);
    expect(fileExists).toBe(true);
  });
  
  // Если модуль существует, проверяем базовую структуру
  if (fs.existsSync(pipelinePath)) {
    const pipelineModule = require('../modules/ocr/pipeline');
    
    test('pipeline module should be defined', () => {
      expect(pipelineModule).toBeDefined();
    });
  }
});