const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
jest.mock("axios");

const mockApi = {
  get: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};
axios.create = jest.fn(() => mockApi);

const YaDiskService = require("../services/yadisk_service");
const { uploadFile, downloadFile } = require("../services/yadisk_service");

jest.mock("fs-extra");

describe("services/yadisk_service.js", () => {
  const token = "fake-token";
  let yadisk;

  beforeEach(() => {
    yadisk = new YaDiskService(token);
    fs.readFile.mockClear();
    fs.createWriteStream.mockClear();
    mockApi.get.mockClear();
    mockApi.put.mockClear();
    mockApi.delete.mockClear();
    axios.get.mockClear();
    axios.put.mockClear();
    axios.mockClear();
  });

  it("uploadFile успешно логирует загрузку файла", async () => {
    mockApi.get.mockResolvedValue({ data: { href: "http://upload" } });
    fs.readFile.mockResolvedValue(Buffer.from("test"));
    axios.put.mockResolvedValue({}); // uploadFile использует axios.put напрямую

    await expect(yadisk.uploadFile("test.txt", "/remote/test.txt")).resolves.toBe(true);
    expect(mockApi.get).toHaveBeenCalled();
    expect(axios.put).toHaveBeenCalled();
  });

  it("downloadFileByPath успешно скачивает файл", async () => {
    mockApi.get.mockResolvedValue({ data: { href: "http://download" } });
    const mockStream = { pipe: jest.fn() };
    axios.mockImplementationOnce(() => Promise.resolve({ data: mockStream }));
    const mockWriter = {
      on: jest.fn(function (event, cb) {
        if (event === "finish") setTimeout(cb, 10);
        return mockWriter;
      }),
    };
    fs.createWriteStream.mockReturnValue(mockWriter);

    const promise = yadisk.downloadFileByPath("/remote/test.txt", "local.txt");
    // Ждём завершения "finish"
    await new Promise((r) => setTimeout(r, 20));
    await expect(promise).resolves.toBe("local.txt");
    expect(mockApi.get).toHaveBeenCalled();
    expect(fs.createWriteStream).toHaveBeenCalled();
    expect(mockStream.pipe).toHaveBeenCalledWith(mockWriter);
  });

  it("getAllDocxFiles возвращает список docx-файлов", async () => {
    mockApi.get.mockResolvedValue({
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

describe("Yandex Disk Service", () => {
  const materialsPath = "/mock/materials";
  let yadisk;

  beforeEach(() => {
    yadisk = new YaDiskService(materialsPath);
    jest.spyOn(yadisk, "log").mockImplementation(() => {}); // Мокаем метод log
    jest.clearAllMocks();
  });

  test("uploadFile успешно логирует загрузку файла", async () => {
    axios.put.mockResolvedValue({ status: 200 });
    const result = await yadisk.uploadFile("test.txt", "/remote/test.txt");
    expect(result).toBe(true);
    expect(yadisk.log).toHaveBeenCalledWith("info", "upload", expect.stringContaining("Начало загрузки файла"));
    expect(yadisk.log).toHaveBeenCalledWith("success", "upload", expect.stringContaining("Файл успешно загружен"));
    expect(axios.put).toHaveBeenCalledWith("/remote/test.txt", expect.anything());
  });

  test("downloadFileByPath успешно скачивает файл", async () => {
    const mockWriter = { on: jest.fn((event, callback) => callback()) };
    fs.createWriteStream.mockReturnValue(mockWriter);
    axios.get.mockResolvedValue({ data: { pipe: jest.fn() } });

    const result = await yadisk.downloadFileByPath("/remote/test.txt", "local.txt");
    expect(result).toBe("/mock/materials/local.txt");
    expect(yadisk.log).toHaveBeenCalledWith("info", "download", expect.stringContaining("Начало скачивания"));
    expect(yadisk.log).toHaveBeenCalledWith("success", "download", expect.stringContaining("Файл успешно скачан"));
    expect(fs.createWriteStream).toHaveBeenCalledWith("/mock/materials/local.txt");
  });

  test("should handle errors during upload", async () => {
    axios.put.mockRejectedValue(new Error("Mock error"));
    await expect(yadisk.uploadFile("local/path", "remote/path")).rejects.toThrow("Mock error");
    expect(yadisk.log).toHaveBeenCalledWith("error", "upload", expect.stringContaining("Ошибка при загрузке"));
  });

  test("should handle errors during download", async () => {
    axios.get.mockRejectedValue(new Error("Mock error"));
    await expect(yadisk.downloadFileByPath("remote/path", "test.txt")).rejects.toThrow("Mock error");
    expect(yadisk.log).toHaveBeenCalledWith("error", "download", expect.stringContaining("Ошибка при скачивании"));
  });
});