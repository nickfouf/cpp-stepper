const Parser = require('tree-sitter');
const Cpp = require('tree-sitter-cpp');

function parseCode(sourceCode) {
    const parser = new Parser();
    parser.setLanguage(Cpp);
    return parser.parse(sourceCode);
}

module.exports = { parseCode };