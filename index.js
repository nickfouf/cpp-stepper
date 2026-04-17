const { parseCode } = require('./parser');
const { evaluate } = require('./evaluator');

const code = `
    #include <iostream>
    using namespace std;

    template <typename T>
    class Box {
    private:
        T value;
    public:
        Box(T v) {
            value = v;
        }
        T getValue() {
            return value;
        }
    };

    template <typename T>
    T add(T a, T b) {
        return a + b;
    }

    int main() {
        cout << "--- Templates ---\\n";
        
        Box<int> intBox(100);
        cout << "intBox: " << intBox.getValue() << "\\n";
        
        Box<float> floatBox(3.14);
        cout << "floatBox: " << floatBox.getValue() << "\\n";
        
        int sum1 = add<int>(5, 10);
        float sum2 = add<float>(1.5, 2.5);
        
        cout << "sum1: " << sum1 << "\\n";
        cout << "sum2: " << sum2 << "\\n";
        
        return 0;
    }
`;


const ast = parseCode(code);

// Initialize state with a Call Stack!
const state = {
    classes: {},
    functions: {},
    templates: {},
    templateArgs: null,
    instantiatingTemplateName: null,
    callStack:[{ name: 'Global', scopes: [{}] }],
    returnedValue: undefined,
    memory: {},
    nextAddress: 0x1000,
    enums: {},
    enumValues: {},
    usingNamespaces:[],
    namespacePrefix: '',
    dynamicTypes: {}
};

const runner = evaluate(ast.rootNode, state);
let stepNumber = 1;

console.log("-----------------------------------------");
console.log("Executing Call Stack & Memory Engine...");
console.log("-----------------------------------------\n");

let lastStepTime = performance.now();

const timer = setInterval(() => {
    const now = performance.now();
    const scheduledDelay = (now - lastStepTime).toFixed(2);
    
    try {
        const execStart = performance.now();
        const step = runner.next();
        const execEnd = performance.now();
        const execTime = (execEnd - execStart).toFixed(2);
        
        lastStepTime = performance.now();

        if (step.done) {
            console.log(`\n✅ Execution Finished Successfully. (Last delay: ${scheduledDelay}ms, exec: ${execTime}ms)`);
            clearInterval(timer);
            return;
        }

        const info = step.value;
        const timingLog = `[+${scheduledDelay}ms, exec: ${execTime}ms]`;

        switch(info.action) {
            case 'skip': 
                console.log(`[Step ${stepNumber}] ${timingLog} ⏭️  Skipped: ${info.text}`);
                break;
            case 'define_function':
                const params = info.params.map(p => `${p.type} ${p.name}`).join(', ');
                console.log(`[Step ${stepNumber}] ${timingLog} 📝 Defined Function: ${info.name}(${params})`);
                break;
            case 'define_class':
                console.log(`[Step ${stepNumber}] ${timingLog} 🏛️  Defined Class: ${info.name}`);
                break;
            case 'define_template':
                console.log(`[Step ${stepNumber}] ${timingLog} 🧩 Defined Template: ${info.name}`);
                break;
            case 'instantiate_template':
                console.log(`[Step ${stepNumber}] ${timingLog} 🧬 Instantiated Template: ${info.name}`);
                break;
            case 'define_enum':
                console.log(`[Step ${stepNumber}] ${timingLog} 📋 Defined Enum: ${info.name} (Class: ${info.isClass})`);
                break;
            case 'define_namespace':
                console.log(`[Step ${stepNumber}] ${timingLog} 🌐 Defined Namespace: ${info.name}`);
                break;
                        case 'enter_frame': console.log(`\n[Step ${stepNumber}] ${timingLog} 🟢 ENTERING STACK FRAME: ${info.name}()`); break;
            
            case 'call_method':
                console.log(`\n[Step ${stepNumber}] ${timingLog} 🔶 METHOD CALL: ${info.className}::${info.name}()`);
                break;
            case 'call_function':
                console.log(`\n[Step ${stepNumber}] ${timingLog} 📞 FUNCTION CALL: ${info.name}()`);
                break;
            case 'declare_obj': 

            case 'declare_var': 
                console.log(`[Step ${stepNumber}] ${timingLog} 📦 Declared: ${info.type} ${info.name} = ${info.value} at[0x${info.address.toString(16)}]`); 
                break;

            case 'assign_var':
                console.log(`[Step ${stepNumber}] ${timingLog} 📝 Assigned:[0x${info.address.toString(16)}] = ${info.value} (Code: ${info.text})`);
                break;
            case 'update_var':
                console.log(`[Step ${stepNumber}] ${timingLog} 🔄 Updated:[0x${info.address.toString(16)}] with '${info.operator}' (New Value: ${info.value})`);
                break;
            case 'read_var':
                console.log(`[Step ${stepNumber}] ${timingLog} 📖 Read Memory: ${info.name} (Got: ${info.value})`);
                break;
            case 'address_of':
                console.log(`[Step ${stepNumber}] ${timingLog} 📍 Address Of: ${info.text} = 0x${info.value.toString(16)}`);
                break;
            case 'dereference':
                console.log(`[Step ${stepNumber}] ${timingLog} 🔍 Dereference: ${info.text} (Address: 0x${info.address.toString(16)}) = ${info.value}`);
                break;
            case 'read_array':
                console.log(`[Step ${stepNumber}] ${timingLog} 📚 Array Read: ${info.text} (Address: 0x${info.address.toString(16)}) = ${info.value}`);
                break;
            case 'heap_allocate':
                console.log(`[Step ${stepNumber}] ${timingLog} 🏗️  Heap Alloc: ${info.size} element(s) at [0x${info.address.toString(16)}]`);
                break;
            case 'heap_free':
                console.log(`[Step ${stepNumber}] ${timingLog} 🗑️  Heap Free: address [0x${info.address.toString(16)}]`);
                break;
            case 'allocate_temp':
                console.log(`[Step ${stepNumber}] ${timingLog} ⏳ Temp Object: Allocated '${info.type}' at [0x${info.address.toString(16)}]`);
                break;

            case 'calculate': console.log(`[Step ${stepNumber}] ${timingLog} 🧮 Calculated: ${info.text} = ${info.value}`); break;
            case 'short_circuit': console.log(`[Step ${stepNumber}] ${timingLog} ⚡ Short-circuit: '${info.operator}' stopped early (Left: ${info.leftValue}, Result: ${info.result})`); break;
            case 'break': console.log(`[Step ${stepNumber}] ${timingLog} 🛑 Break encountered`); break;
            case 'continue': console.log(`[Step ${stepNumber}] ${timingLog} ⏭️  Continue encountered`); break;
            case 'print':
                const printVal = typeof info.value === 'string' ? info.value.replace(/\\n/g, '\n') : info.value;
                process.stdout.write(`[Step ${stepNumber}] ${timingLog} 🖨️  Streamed to cout: ${printVal}`);
                if (!String(printVal).endsWith('\n')) console.log();
                break;
            case 'return_from_function': console.log(`[Step ${stepNumber}] ${timingLog} 🔙 Returned from ${info.name} (Value: ${info.value})`); break;
                        case 'return': console.log(`[Step ${stepNumber}] ${timingLog} 📤 Return statement (Value: ${info.value})`); break;
            case 'enter_try': console.log(`[Step ${stepNumber}] ${timingLog} 🛡️  Entered 'try' block`); break;
            case 'throw': console.log(`[Step ${stepNumber}] ${timingLog} 🚨 THROW: Executing throw statement (Value: ${info.value}, Type: ${info.type})`); break;
            case 'catch': console.log(`[Step ${stepNumber}] ${timingLog} 🪂 CATCH: Exception intercepted! (Matched Type: ${info.type}, Value: ${info.value})`); break;
            default: console.log(`[Step ${stepNumber}] ${timingLog} ⚡ Action: ${info.action}`); break;
        }
        stepNumber++;


    } catch (error) {

        console.error(`\n❌ compilation terminated.`);
        console.error(`\x1b[31m${error.message}\x1b[0m`);
        clearInterval(timer);
    }
}, 100);
