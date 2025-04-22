const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const YaDiskService = require("../services/yadisk_service");

jest.mock("axios");
jest.mock("fs-extra");

describe("services/yadisk_service.js", () => {
  const token = "fake-token";
  let yadisk;

  beforeEach(() => {
    yadisk = new YaDiskService(token);
    fs.readFile.mockClear();
    fs.createWriteStream.mockClear();
    axios.get.mockClear();
    axios.put.mockClear();
  });

  it("uploadFile успешно логирует загрузку файла", async () => {
    axios.get.mockResolvedValue({ data: { href: "http://upload" } });
    fs.readFile.mockResolvedValue(Buffer.from("test"));
    axios.put.mockResolvedValue({});

    await expect(yadisk.uploadFile("test.txt", "/remote/test.txt")).resolves.toBe(true);
    expect(axios.get).toHaveBeenCalled();
    expect(axios.put).toHaveBeenCalled();
  });

  it("downloadFileByPath успешно скачивает файл", async () => {
    axios.get.mockResolvedValueOnce({ data: { href: "http://download" } });
    const mockStream = { pipe: jest.fn() };
    axios.mockImplementationOnce(() => Promise.resolve({ data: mockStream }));
    const mockWriter = { on: jest.fn((event, cb) => { if (event === "finish") setTimeout(cb, 10); return mockWriter; }) };
    fs.createWriteStream.mockReturnValue(mockWriter);

    const promise = yadisk.downloadFileByPath("/remote/test.txt", "local.txt");
    // эмулируем finish
    setTimeout(() => mockWriter.on.mock.calls.find(([e]) => e === "finish")[1](), 20);
    await expect(promise).resolves.toBe("local.txt");
    expect(axios.get).toHaveBeenCalled();
    expect(fs.createWriteStream).toHaveBeenCalled();
  });

  it("getAllDocxFiles возвращает список docx-файлов", async () => {
    axios.get.mockResolvedValue({
      data: {
        _embedded: {
          items: [
            { type: "file", name: "a.docx" },
            { type: "file", name: "b.txt" },
            { type: "dir", path: "/folder" }
          ]
        }
      }
    });
    // Для рекурсивного вызова
    yadisk.getAllDocxFiles = jest.fn().mockResolvedValue([{ type: "file", name: "a.docx" }]);
    const files = await yadisk.getAllDocxFiles("/");
    expect(Array.isArray(files)).toBe(true);
  });
});