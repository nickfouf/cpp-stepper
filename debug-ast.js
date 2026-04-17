const { parseCode } = require('./parser');

const code = `
int main() {
    int x = 10;
    int* p = &x;
    return 0;
}
`;

const ast = parseCode(code);

function traverse(node) {
    if (node.type === 'pointer_expression' || node.type === 'reference_expression' || node.type === 'unary_expression') {
        console.log(`\nFound: ${node.type}`);
        console.log(`Text: ${node.text}`);
        console.log(`Children:`);
        node.children.forEach((c, i) => {
            console.log(`  [${i}] type=${c.type}, text=${c.text}`);
        });
    }
    for (let i = 0; i < node.namedChildCount; i++) {
        traverse(node.namedChild(i));
    }
}
traverse(ast.rootNode);