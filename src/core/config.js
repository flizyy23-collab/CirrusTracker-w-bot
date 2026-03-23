const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor(configPath = '../config.json', templatePath = '../config.example.json') {
        this.configPath = path.resolve(__dirname, '../../config.json');
        this.templatePath = path.resolve(__dirname, '../../config.example.json');
        this.config = null;

        this.initialize();
    }

    initialize() {
        try {
            if (process.env.CONFIG_JSON) {
                this.loadConfigFromEnv();
            } else {
                if (!fs.existsSync(this.configPath)) {
                    this.createConfigFromTemplate();
                }
                this.loadConfig();
            }
        } catch (error) {
            console.error('Error initializing config:', error.message);
            throw error;
        }
    }

    loadConfigFromEnv() {
        try {
            this.config = JSON.parse(process.env.CONFIG_JSON);
            console.log('Loaded config from CONFIG_JSON environment variable');
        } catch (error) {
            throw new Error(`Failed to parse CONFIG_JSON environment variable: ${error.message}`);
        }
    }

    createConfigFromTemplate() {
        try {
            if (!fs.existsSync(this.templatePath)) {
                throw new Error(`Template file not found: ${this.templatePath}`);
            }

            const templateData = fs.readFileSync(this.templatePath, 'utf8');

            JSON.parse(templateData);

            fs.writeFileSync(this.configPath, templateData);
            console.log(`Created ${this.configPath} from ${this.templatePath}`);
        } catch (error) {
            throw new Error(`Failed to create config from template: ${error.message}`);
        }
    }

    loadConfig() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
        } catch (error) {
            throw new Error(`Failed to load config: ${error.message}`);
        }
    }

    get(key, defaultValue = undefined) {
        if (!this.config) {
            throw new Error('Config not loaded');
        }

        const keys = key.split('.');
        let value = this.config;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }

        return value;
    }
}

const configManager = new ConfigManager();

module.exports = {
    ConfigManager,
    config: configManager,

    get: (key, defaultValue) => configManager.get(key, defaultValue),
};
