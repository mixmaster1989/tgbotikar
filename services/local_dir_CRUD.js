const fs = require('fs-extra');
const path = require('path');

class LocalDirCRUD {
    constructor(materialsPath) {
        this.materialsPath = materialsPath;
        fs.ensureDirSync(this.materialsPath)
    }

    async syncMaterials() {
        return fs.readdirSync(this.materialsPath);
    }

    async get(name) {
        return fs.readFileSync(path.join(this.materialsPath, name), 'utf-8');
    }
    async checkAccess() {
        return false
    }
}

module.exports = LocalDirCRUD;