# C++ Stepper

An educational, step-by-step C++ execution engine built with JavaScript and [Tree-sitter](https://tree-sitter.github.io/tree-sitter/).

C++ Stepper parses C++ code into an Abstract Syntax Tree (AST) using Tree-sitter and evaluates it step-by-step. It simulates a virtual memory environment, a call stack, heap allocations, and even complex language features like classes, templates, pointers, and exceptions. 

This project is great for visualizing how C++ executes under the hood! As a primary use case, it can be seamlessly integrated into an educational app to provide interactive, step-by-step execution of C++ code, helping students visualize algorithms, memory states, and control flow in real time.

## Features

- **Step-by-Step Execution Loop:** Watch your C++ code run statement by statement with detailed logging.
- **Virtual Memory & Call Stack:** Simulates memory addresses, heap allocation, stack frames, and scoping.
- **Object-Oriented Programming:** Supports classes, structs, constructors/destructors, inheritance, and dynamic dispatch (virtual methods).
- **Templates:** Basic support for function and class templates instantiation.
- **Pointers & References:** Handles the address-of operator (`&`), dereferencing (`*`), and reference variables.
- **Exception Handling:** Try/catch blocks and throwing standard or custom types.
- **Dynamic Memory Allocation:** Heap allocation and deallocation using `new` and `delete`.

## Prerequisites

- Node.js (v14 or higher recommended)
- npm

## Installation

1. Clone the repository and navigate to the project directory:
   ```bash
   cd cpp-stepper
   ```
2. Install the required dependencies:
   ```bash
   npm install
   ```

## Usage

Run the main execution engine:

```bash
node index.js
```

This will parse and execute the embedded sample C++ code found in `index.js`, slowly printing each action (variable declarations, memory operations, method calls, etc.) to the console with timed delays.

To test your own C++ snippet, simply open `index.js` and modify the `code` string variable at the top of the file!

### Example Execution: Templates

Here is an example of what the engine evaluates and logs when running C++ code involving templates:

**Input C++ Code (`index.js`):**
```cpp
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
    cout << "--- Templates ---\n";
    
    Box<int> intBox(100);
    cout << "intBox: " << intBox.getValue() << "\n";
    
    Box<float> floatBox(3.14);
    cout << "floatBox: " << floatBox.getValue() << "\n";
    
    int sum1 = add<int>(5, 10);
    float sum2 = add<float>(1.5, 2.5);
    
    cout << "sum1: " << sum1 << "\n";
    cout << "sum2: " << sum2 << "\n";
    
    return 0;
}
```

**Console Output:**
```text
-----------------------------------------
Executing Call Stack & Memory Engine...
-----------------------------------------

[Step 1] [+111.22ms, exec: 0.72ms] ⏭️  Skipped: #include <iostream>
[Step 2] [+109.91ms, exec: 1.23ms] ⏭️  Skipped: using namespace std;
[Step 3] [+109.99ms, exec: 0.97ms] 🧩 Defined Template: Box
[Step 4] [+107.03ms, exec: 0.69ms] 🧩 Defined Template: add
[Step 5] [+109.99ms, exec: 0.82ms] 📝 Defined Function: main()

[Step 6] [+102.10ms, exec: 0.04ms] 🟢 ENTERING STACK FRAME: main()
[Step 7] [+110.54ms, exec: 2.44ms] 🖨️  Streamed to cout: --- Templates ---
[Step 8] [+98.24ms, exec: 1.41ms] 🧬 Instantiated Template: Box<int>
[Step 9] [+105.10ms, exec: 1.36ms] 🏛️  Defined Class: Box<int>
[Step 10] [+110.02ms, exec: 2.16ms] 📦 Declared: Box<int> intBox = undefined at[0x1000]

[Step 11] [+107.89ms, exec: 1.47ms] 🔶 METHOD CALL: Box<int>::Box()
[Step 12] [+107.10ms, exec: 0.48ms] 📖 Read Memory: v (Got: 100)
[Step 13] [+107.61ms, exec: 0.31ms] 📝 Assigned:[0x1000] = 100 (Code: value = v)
[Step 14] [+107.63ms, exec: 0.38ms] 🔙 Returned from Box (Value: undefined)
[Step 15] [+108.70ms, exec: 0.46ms] 🖨️  Streamed to cout: intBox: 

[Step 16] [+108.22ms, exec: 0.35ms] 🔶 METHOD CALL: Box<int>::getValue()
[Step 17] [+108.12ms, exec: 0.48ms] 📖 Read Memory: value (Got: 100)
[Step 18] [+101.71ms, exec: 0.09ms] 📤 Return statement (Value: 100)
[Step 19] [+111.53ms, exec: 0.12ms] 🔙 Returned from getValue (Value: 100)
[Step 20] [+110.29ms, exec: 0.03ms] 🖨️  Streamed to cout: 100
[Step 21] [+110.27ms, exec: 0.06ms] 🖨️  Streamed to cout: \n
[Step 22] [+109.07ms, exec: 0.16ms] 🧬 Instantiated Template: Box<float>
[Step 23] [+109.25ms, exec: 0.66ms] 🏛️  Defined Class: Box<float>
[Step 24] [+109.94ms, exec: 0.37ms] 📦 Declared: Box<float> floatBox = undefined at[0x1004]

[Step 25] [+108.08ms, exec: 0.28ms] 🔶 METHOD CALL: Box<float>::Box()
[Step 26] [+112.08ms, exec: 0.51ms] 📖 Read Memory: v (Got: 3.14)
[Step 27] [+100.43ms, exec: 0.06ms] 📝 Assigned:[0x1004] = 3.14 (Code: value = v)
[Step 28] [+111.50ms, exec: 0.07ms] 🔙 Returned from Box (Value: undefined)
[Step 29] [+111.37ms, exec: 1.91ms] 🖨️  Streamed to cout: floatBox: 

[Step 30] [+100.08ms, exec: 0.66ms] 🔶 METHOD CALL: Box<float>::getValue()
[Step 31] [+110.20ms, exec: 0.48ms] 📖 Read Memory: value (Got: 3.14)
[Step 32] [+110.08ms, exec: 0.06ms] 📤 Return statement (Value: 3.14)
[Step 33] [+109.91ms, exec: 0.06ms] 🔙 Returned from getValue (Value: 3.14)
[Step 34] [+116.10ms, exec: 0.03ms] 🖨️  Streamed to cout: 3.14
[Step 35] [+111.47ms, exec: 0.18ms] 🖨️  Streamed to cout: \n
[Step 36] [+101.12ms, exec: 0.87ms] 🧬 Instantiated Template: add<int>
[Step 37] [+110.02ms, exec: 0.59ms] 📝 Defined Function: add<int>(int a, int b)

[Step 38] [+112.17ms, exec: 0.69ms] 📞 FUNCTION CALL: add<int>()
[Step 39] [+111.27ms, exec: 0.76ms] 📖 Read Memory: a (Got: 5)
[Step 40] [+109.41ms, exec: 0.33ms] 📖 Read Memory: b (Got: 10)
[Step 41] [+110.52ms, exec: 0.06ms] 🧮 Calculated: 5 + 10 = 15
[Step 42] [+112.01ms, exec: 0.06ms] 📤 Return statement (Value: 15)
[Step 43] [+112.63ms, exec: 0.30ms] 🔙 Returned from add<int> (Value: 15)
[Step 44] [+107.24ms, exec: 0.10ms] 📦 Declared: int sum1 = 15 at[0x100a]
[Step 45] [+109.68ms, exec: 0.21ms] 🧬 Instantiated Template: add<float>
[Step 46] [+112.12ms, exec: 0.38ms] 📝 Defined Function: add<float>(float a, float b)

[Step 47] [+102.81ms, exec: 0.21ms] 📞 FUNCTION CALL: add<float>()
[Step 48] [+104.91ms, exec: 0.17ms] 📖 Read Memory: a (Got: 1.5)
[Step 49] [+111.18ms, exec: 0.10ms] 📖 Read Memory: b (Got: 2.5)
[Step 50] [+107.56ms, exec: 0.13ms] 🧮 Calculated: 1.5 + 2.5 = 4
[Step 51] [+108.96ms, exec: 0.09ms] 📤 Return statement (Value: 4)
[Step 52] [+107.00ms, exec: 0.09ms] 🔙 Returned from add<float> (Value: 4)
[Step 53] [+104.56ms, exec: 0.13ms] 📦 Declared: float sum2 = 4 at[0x100d]
[Step 54] [+110.01ms, exec: 0.94ms] 🖨️  Streamed to cout: sum1: 
[Step 55] [+108.44ms, exec: 0.30ms] 📖 Read Memory: sum1 (Got: 15)
[Step 56] [+102.99ms, exec: 0.10ms] 🖨️  Streamed to cout: 15
[Step 57] [+111.16ms, exec: 0.11ms] 🖨️  Streamed to cout: \n
[Step 58] [+100.45ms, exec: 0.77ms] 🖨️  Streamed to cout: sum2: 
[Step 59] [+111.27ms, exec: 0.21ms] 📖 Read Memory: sum2 (Got: 4)
[Step 60] [+111.96ms, exec: 0.07ms] 🖨️  Streamed to cout: 4
[Step 61] [+110.74ms, exec: 0.19ms] 🖨️  Streamed to cout: \n
[Step 62] [+108.22ms, exec: 0.31ms] 📤 Return statement (Value: 0)

✅ Execution Finished Successfully. (Last delay: 111.95ms, exec: 0.54ms)
```

### Debugging the AST

If you'd like to inspect how Tree-sitter parses a piece of C++ code into an AST and identify specific node types, use the `debug-ast.js` utility:

```bash
node debug-ast.js
```

## Project Structure

- `index.js`: The main entry point containing the runner, the event loop simulator, and the C++ code to evaluate.
- `evaluator.js`: The core execution engine. Contains the generator functions for evaluating AST nodes, managing the virtual memory, and simulating C++ semantics.
- `parser.js`: A simple wrapper around `tree-sitter` and `tree-sitter-cpp` to generate the AST.
- `debug-ast.js`: A helper script for traversing and logging the AST nodes generated by Tree-sitter.

## Limitations

This is an experimental, educational interpreter for a subset of C++. It does not parse or link against the actual standard library headers (e.g., `<iostream>` is mocked/skipped) and relies on an internal AST evaluator rather than a real compiler. It is meant to demonstrate how code execution, memory management, and OOP features translate conceptually to a simulated environment.

## License

This project is licensed under the MIT License.
