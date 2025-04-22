const fs = require("fs-extra");
const path = require("path");
const { convertDocxToPdf, generatePdfThumbnail } = require("../modules/docx2pdf");



describe("modules/docx2pdf.js", () => {
  const docxPath = path.join(__dirname, "..", "materials", "test.docx");
  const pdfPath = path.join(__dirname, "..", "cache", "test.pdf");
  const thumbPath = path.join(__dirname, "..", "cache", "test.png");

  beforeAll(async () => {
    // Убедитесь, что тестовый DOCX существует
    if (!(await fs.pathExists(docxPath))) {
      // Можно создать простой DOCX или бросить ошибку
      throw new Error("Для теста нужен файл materials/test.docx");
    }
  });

  afterAll(async () => {
    // Удаляем тестовые файлы после теста
    await fs.remove(pdfPath);
    await fs.remove(thumbPath);
  });

  it("convertDocxToPdf конвертирует DOCX в PDF", async () => {
    await convertDocxToPdf(docxPath, pdfPath);
    expect(await fs.pathExists(pdfPath)).toBe(true);
    const stats = await fs.stat(pdfPath);
    expect(stats.size).toBeGreaterThan(100); // PDF не пустой
  });

  
});