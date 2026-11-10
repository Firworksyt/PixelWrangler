import js from "@eslint/js";
import globals from "globals";

export default [
    { ignores: ["node_modules/", "coverage/"] },
    js.configs.recommended,
    {
        files: ["public/**/*.js"],
        languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    },
    {
        files: ["scripts/**/*.js", "*.config.js"],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        files: ["__tests__/**/*.js"],
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
    },
    {
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error",
        },
    },
];
