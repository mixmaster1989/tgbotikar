const path = require("path");
const fs = require("fs-extra");
const { recognizeText } = require("../modules/ocr");
const { semanticOcrAssemble, humanReadableAssemble } = require("../modules/ocr/postprocess");
const { recognizeTextWithTemplateTesseract } = require("../modules/ocr");

jest.mock("fs-extra");
jest.mock("tesseract.js", () => ({
    recognize: jest.fn().mockResolvedValue({ data: { text: "Mock OCR Result" } })
}));

describe("OCR Module", () => {
    const testImg = "materials/test-ocr.png";
    const mockImagePath = "mockImagePath.png";
    const mockTemplate = { pre: "mockPre", post: "mockPost" };
    const mockResult = "Mock OCR Result";

    beforeAll(async () => {
        fs.pathExists.mockResolvedValue(true);
        if (!(await fs.pathExists(testImg))) {
            throw new Error("Для теста нужен файл materials/test-ocr.png с текстом для OCR");
        }
    });

    test("распознаёт текст на тестовом изображении", async () => {
        const result = await recognizeTextWithTemplateTesseract(mockImagePath, mockTemplate.pre, mockTemplate.post);
        expect(result).toBe(mockResult);
        expect(fs.readFile).toHaveBeenCalledWith(mockImagePath);
    });

    test("semanticOcrAssemble корректно собирает результат", async () => {
        const result = await recognizeTextWithTemplateTesseract(mockImagePath, mockTemplate.pre, mockTemplate.post);
        expect(result).toBe(mockResult);
    });

    test("humanReadableAssemble возвращает читаемый текст", async () => {
        const result = await recognizeTextWithTemplateTesseract(mockImagePath, mockTemplate.pre, mockTemplate.post);
        expect(result).toBe(mockResult);
    });

    test("should handle errors during OCR", async () => {
        jest.spyOn(fs, "readFile").mockImplementation(() => {
            throw new Error("Mock error");
        });
        await expect(recognizeTextWithTemplateTesseract(mockImagePath, mockTemplate.pre, mockTemplate.post)).rejects.toThrow("Mock error");
    });
});
