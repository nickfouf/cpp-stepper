function throwCompilerError(message) {
    throw new Error(`error: ${message}`);
}

function resolveType(state, typeText) {
    if (!state.templateArgs || !typeText) return typeText;
    let newType = typeText;
    for (const [key, val] of Object.entries(state.templateArgs)) {
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        newType = newType.replace(regex, val);
    }
    return newType;
}

function currentFrame(state) {
    return state.callStack[state.callStack.length - 1];
}

function getClassDef(state, className) {
    const cls = state.classes[className];
    if (!cls) return null;
    if (cls.flattened) return cls;
    
    cls.flattenedFields = [...cls.fields];
    cls.flattenedMethods = {};
    Object.keys(cls.methods).forEach(k => {
        cls.flattenedMethods[k] = [...cls.methods[k]];
    });
    cls.totalSize = cls.size;
    
    if (cls.baseClass) {
        const baseCls = getClassDef(state, cls.baseClass);
        if (baseCls) {
            cls.flattenedFields.forEach(f => f.offset += baseCls.totalSize);
            cls.flattenedFields =[...baseCls.flattenedFields, ...cls.flattenedFields];
            
            if (baseCls.destructor && baseCls.destructor.isVirtual && cls.destructor) {
                cls.destructor.isVirtual = true;
            }

            Object.keys(baseCls.flattenedMethods).forEach(k => {
                if (!cls.flattenedMethods[k]) {
                    cls.flattenedMethods[k] = [];
                }
                const baseMethods = baseCls.flattenedMethods[k];
                const derivedMethods = cls.flattenedMethods[k];
                
                baseMethods.forEach(bm => {
                    const overridden = derivedMethods.find(dm => {
                        if (dm.params.length !== bm.params.length) return false;
                        for (let i = 0; i < dm.params.length; i++) {
                            if (dm.params[i].type !== bm.params[i].type) return false;
                        }
                        return true;
                    });
                    
                    if (overridden) {
                        if (bm.isVirtual) overridden.isVirtual = true;
                    } else {
                        derivedMethods.push(bm);
                    }
                });
            });
            cls.totalSize += baseCls.totalSize;
        }
    }
    
    cls.flattened = true;
    return cls;
}

function isDerived(state, derivedName, baseName) {
    let curr = getClassDef(state, derivedName);
    while (curr) {
        if (curr.name === baseName) return true;
        if (!curr.baseClass) break;
        curr = getClassDef(state, curr.baseClass);
    }
    return false;
}

function findVar(state, name) {
    const frame = currentFrame(state);
    if (frame) {
        for (let i = frame.scopes.length - 1; i >= 0; i--) {
            if (name in frame.scopes[i]) return frame.scopes[i][name];
        }
        if (frame.methodOf) {
            const cls = getClassDef(state, frame.methodOf);
            if (cls) {
                const field = cls.flattenedFields.find(f => f.name === name);
                if (field) {
                    const thisEntry = frame.scopes[0]['this'];
                    const objAddr = readMem(state, thisEntry.address);
                    return { _type: field.type, address: objAddr + field.offset, isClassMember: true };
                }
            }
        }
    }
    // Fallback to global frame (at index 0)
    if (state.callStack.length > 0) {
        const globalFrame = state.callStack[0];
        if (name in globalFrame.scopes[0]) return globalFrame.scopes[0][name];
    }
    return null;
}


function getTypeOfNode(node, state) {
    if (node.type === 'number_literal') return node.text.includes('.') ? 'float' : 'int';
    if (node.type === 'string_literal') return 'char*';
    if (node.type === 'char_literal') return 'char';
    if (node.type === 'true' || node.type === 'false' || node.type === 'boolean') return 'bool';
    if (node.type === 'identifier') {
        const v = findVar(state, node.text);
        if (v) return v._type;
    } else if (node.type === 'field_expression') {
        const argNode = node.childForFieldName('argument') || node.namedChild(0);
        const fieldNameNode = node.childForFieldName('field') || node.namedChild(node.namedChildCount - 1);
        const baseType = getTypeOfNode(argNode, state);
        if (!baseType) return 'unknown';
        const className = baseType.replace(/[\*&]/g, '');
        const cls = getClassDef(state, className);
        if (cls) {
            const field = cls.flattenedFields.find(f => f.name === fieldNameNode.text);
            if (field) return field.type;
        }
    } else if (node.type === 'this') {
        const frame = currentFrame(state);
        return frame.methodOf + '*';
    } else if (node.type === 'pointer_expression' || node.type === 'dereference_expression') {
         const argType = getTypeOfNode(node.namedChild(0), state);
         if (argType) return argType.replace('*', '');
    } else if (node.type === 'new_expression') {
         const typeNode = node.childForFieldName('type');
         if (typeNode) return typeNode.text + '*';
    } else if (node.type === 'call_expression') {
         const funcNode = node.childForFieldName('function');
         if (funcNode.type === 'identifier') {
             const cls = getClassDef(state, funcNode.text);
             if (cls) return funcNode.text;
         }
         return 'unknown';
    } else if (node.type === 'subscript_expression') {
         const argType = getTypeOfNode(node.namedChild(0), state);
         if (argType) {
             const className = argType.replace(/[\*&]/g, '');
             const cls = getClassDef(state, className);
             if (cls && cls.flattenedMethods['operator[]']) {
                 const method = cls.flattenedMethods['operator[]'][0];
                 if (method && method.retType) return method.retType;
             }
         }
    } else if (node.type === 'binary_expression' || node.type === 'unary_expression' || node.type === 'parenthesized_expression') {
         const firstChild = node.namedChild(0);
         if (node.type === 'binary_expression') {
             const operator = node.childForFieldName('operator') ? node.childForFieldName('operator').text : node.children[1].text;
             const firstType = getTypeOfNode(firstChild, state);
             if (firstType) {
                 const className = firstType.replace(/[\*&]/g, '');
                 const cls = getClassDef(state, className);
                 if (cls && cls.flattenedMethods['operator' + operator]) {
                     const method = cls.flattenedMethods['operator' + operator][0];
                     if (method && method.retType) return method.retType;
                     return className;
                 }
             }
         }
         if (firstChild) return getTypeOfNode(firstChild, state) || 'int';
    }
    return 'unknown';
}

function* callConstructors(state, className, objAddr, args) {
    const cls = getClassDef(state, className);
    if (!cls) return;
    if (cls.baseClass) yield* callConstructors(state, cls.baseClass, objAddr,[]);
    
    if (cls.constructors && cls.constructors.length > 0) {
        const possibleMatches = cls.constructors.filter(m => m.params.length === args.length);
        if (possibleMatches.length > 0) {
            let target = possibleMatches[0];
            yield* callMethod(state, target, objAddr, className, args);
        } else if (args.length > 0) {
             throwCompilerError(`no matching constructor for '${className}'`);
        }
    }
}

function* callDestructors(state, className, objAddr) {
    const cls = getClassDef(state, className);
    if (!cls) return;
    if (cls.destructor) yield* callMethod(state, cls.destructor, objAddr, className,[]);
    if (cls.baseClass) yield* callDestructors(state, cls.baseClass, objAddr);
}

function* cleanupScope(state, scope) {
    const keys = Object.keys(scope).reverse();
    for (const key of keys) {
        const entry = scope[key];
        if (entry.isObject && entry.className) {
            yield* callDestructors(state, entry.className, entry.address);
        }
    }
}

function allocate(state, value, size = 1) {
    const addr = state.nextAddress;
    for (let i = 0; i < size; i++) {
        if (Array.isArray(value)) {
            state.memory[addr + i] = (value[i] !== undefined) ? value[i] : 0;
        } else {
            state.memory[addr + i] = (value !== null && value !== undefined) ? value : 0;
        }
    }
    state.nextAddress += size;
    return addr;
}

function readMem(state, addr) {
    if (addr === undefined || !(addr in state.memory)) throwCompilerError(`Segmentation fault: reading from unallocated address ${addr}`);
    return state.memory[addr];
}

function writeMem(state, addr, value) {
    if (addr === undefined || !(addr in state.memory)) throwCompilerError(`Segmentation fault: writing to unallocated address ${addr}`);
    state.memory[addr] = value;
}

function* callMethod(state, funcDef, objAddr, className, args) {
    const newFrame = { name: funcDef.name, scopes: [{}], methodOf: className, retType: funcDef.retType };
    newFrame.scopes[0]['this'] = { _type: className + '*', address: allocate(state, objAddr) };

    funcDef.params.forEach((param, index) => {
        const isRef = param.type.includes('&');
        let addr = isRef ? args[index] : allocate(state, args[index]);
        newFrame.scopes[0][param.name] = { _type: param.type, address: addr };
    });

    yield { action: 'call_method', name: funcDef.name, className: className, args: args };

    state.callStack.push(newFrame);
    const oldRet = state.returnedValue;
    state.returnedValue = undefined;
    
    const cls = getClassDef(state, className);
    const oldTemplateArgs = state.templateArgs;
    if (cls && cls.templateArgs) {
        state.templateArgs = cls.templateArgs;
    }

    let result;
    try {
        yield* evaluate(funcDef.body, state);
        result = state.returnedValue;
        yield { action: 'return_from_function', name: funcDef.name, value: result };
    } finally {
        state.templateArgs = oldTemplateArgs;
        state.returnedValue = oldRet;
        if (state.callStack[state.callStack.length - 1] === newFrame) {
            state.callStack.pop();
        }
    }

    return result;
}

function* instantiateClassTemplateIfNeeded(state, fullTypeName) {
    if (!fullTypeName) return;
    if (state.classes[fullTypeName]) return;
    
    const match = fullTypeName.match(/^([A-Za-z0-9_:]+)<(.+)>$/);
    if (!match) return;
    
    const templateName = match[1];
    const tmpl = state.templates && state.templates[templateName];
    if (!tmpl || !tmpl.isClass) return;

    let typeArgs = match[2].split(',').map(s => resolveType(state, s.trim()).replace(/\s+/g, ''));
    
    const oldTemplateArgs = state.templateArgs;
    state.templateArgs = { ...(state.templateArgs || {}) };
    tmpl.templateParams.forEach((param, i) => {
        state.templateArgs[param] = typeArgs[i] || 'int';
    });

    const oldName = state.instantiatingTemplateName;
    state.instantiatingTemplateName = fullTypeName;
    
    yield { action: 'instantiate_template', name: fullTypeName };
    yield* evaluate(tmpl.astNode, state);
    
    state.instantiatingTemplateName = oldName;
    state.templateArgs = oldTemplateArgs;
}

function* evaluateLValue(node, state) {
    if (node.type === 'identifier') {
        const entry = findVar(state, node.text);
        if (!entry) throwCompilerError(`use of undeclared identifier '${node.text}'`);
        return entry.address;
    }
    if (node.type === 'qualified_identifier') {
        const scopeNode = node.childForFieldName('scope') || node.namedChild(0);
        const nameNode = node.childForFieldName('name') || node.namedChild(node.namedChildCount - 1);
        const fullName = scopeNode.text + "::" + nameNode.text;
        
        const entry = findVar(state, fullName);
        if (!entry) throwCompilerError(`use of undeclared identifier '${fullName}'`);
        return entry.address;
    }
    if (node.type === 'field_expression') {
        const argNode = node.childForFieldName('argument') || node.namedChild(0);
        const fieldNameNode = node.childForFieldName('field') || node.namedChild(node.namedChildCount - 1);
        const isPointer = node.children.some(c => c.type === '->');
        
        let objAddr, objType;
        if (isPointer) {
            objAddr = yield* evaluate(argNode, state);
            objType = getTypeOfNode(argNode, state);
        } else {
            objAddr = yield* evaluateLValue(argNode, state);
            objType = getTypeOfNode(argNode, state);
        }
        
        if (!objType || objType === 'unknown') throwCompilerError(`cannot determine type for field access`);
        const className = objType.replace(/[\*&]/g, '');
        const cls = getClassDef(state, className);
        if (!cls) throwCompilerError(`unknown class '${className}'`);
        
        const fieldName = fieldNameNode.text;
        const field = cls.flattenedFields.find(f => f.name === fieldName);
        if (!field) throwCompilerError(`class '${className}' has no member '${fieldName}'`);
        
        const frame = currentFrame(state);
        if (field.access === 'private') {
            if (frame.methodOf !== className) throwCompilerError(`'${fieldName}' is a private member of '${className}'`);
        } else if (field.access === 'protected') {
            if (frame.methodOf !== className && !isDerived(state, frame.methodOf, className)) {
                throwCompilerError(`'${fieldName}' is a protected member of '${className}'`);
            }
        }
        
        return objAddr + field.offset;
    }
    if (node.type === 'unary_expression' || node.type === 'pointer_expression' || node.type === 'reference_expression' || node.type === 'address_expression') {
        const op = node.childForFieldName('operator') ? node.childForFieldName('operator').text : node.children[0].text;
        if (op === '*') {
            const argNode = node.childForFieldName('argument') || node.children[node.children.length - 1];
            return yield* evaluate(argNode, state);
        }
    }
    if (node.type === 'subscript_expression') {
        const argNode = node.childForFieldName('argument') || node.namedChild(0);
        const indexNode = node.childForFieldName('indices') || node.childForFieldName('index') || node.namedChild(1);

        const argType = getTypeOfNode(argNode, state);
        if (argType && argType !== 'unknown') {
            const className = argType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls) {
                const methods = cls.flattenedMethods['operator[]'] || [];
                if (methods.length > 0) {
                    const targetFuncDef = methods[0];
                    const objAddr = yield* evaluateLValue(argNode, state);
                    const param = targetFuncDef.params[0];
                    const evaluatedArgs = [];
                    evaluatedArgs.push(param && param.type.includes('&') ? yield* evaluateLValue(indexNode, state) : yield* evaluate(indexNode, state));
                    
                    // The method returns a reference (address) for LValue usage
                    return yield* callMethod(state, targetFuncDef, objAddr, className, evaluatedArgs);
                }
            }
        }

        const arrayAddr = yield* evaluate(argNode, state);
        const index = yield* evaluate(indexNode, state);
        return arrayAddr + index;
    }
    if (node.type === 'parenthesized_expression') {
        return yield* evaluateLValue(node.namedChild(0), state);
    }
    throwCompilerError(`expression is not assignable`);
}

function* evaluate(node, state) {
    if (!node) return;

    if (node.type === 'translation_unit') {
        for (let i = 0; i < node.namedChildCount; i++) {
            yield* evaluate(node.namedChild(i), state);
        }
        return;
    }

    if (node.type === 'template_declaration') {
        const paramsNode = node.childForFieldName('parameters');
        let declNode = node.children.find(c => c.type === 'class_specifier' || c.type === 'struct_specifier' || c.type === 'function_definition' || c.type === 'declaration');
        
        if (declNode && declNode.type === 'declaration') {
            const inner = declNode.children.find(c => c.type === 'class_specifier' || c.type === 'struct_specifier' || c.type === 'function_definition');
            if (inner) declNode = inner;
        }

        const templateParams = [];
        if (paramsNode) {
            for (let i = 0; i < paramsNode.namedChildCount; i++) {
                const p = paramsNode.namedChild(i);
                if (p.type === 'type_parameter_declaration' || p.type === 'parameter_declaration') {
                    const idNode = p.children.find(c => c.type === 'type_identifier' || c.type === 'identifier');
                    if (idNode) templateParams.push(idNode.text);
                }
            }
        }
        
        if (declNode) {
            let name = "unknown";
            let isClass = false;
            if (declNode.type === 'class_specifier' || declNode.type === 'struct_specifier') {
                const nameNode = declNode.childForFieldName('name');
                if (nameNode) name = nameNode.text;
                isClass = true;
            } else if (declNode.type === 'function_definition') {
                const funcDeclNode = declNode.childForFieldName('declarator');
                let currDecl = funcDeclNode;
                while (currDecl && currDecl.type !== 'function_declarator' && currDecl.namedChildCount > 0) {
                    currDecl = currDecl.namedChild(0);
                }
                if (currDecl && currDecl.type === 'function_declarator') {
                    const dNode = currDecl.childForFieldName('declarator');
                    name = dNode ? dNode.text : "unknown";
                } else {
                    name = funcDeclNode.text.split('(')[0];
                }
            }
            
            state.templates = state.templates || {};
            state.templates[name] = {
                name,
                isClass,
                templateParams,
                astNode: declNode
            };
            yield { action: 'define_template', name };
        }
        return;
    }

    if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
        const nameNode = node.childForFieldName('name');
        const className = state.instantiatingTemplateName || nameNode.text;
        
        const classDef = {
            name: className,
            fields: [],
            methods: {},
            constructors:[],
            destructor: null,
            size: 0,
            baseClass: null,
            templateArgs: state.templateArgs ? { ...state.templateArgs } : null
        };
        
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child.type === 'base_class_clause') {
                const typeId = child.namedChild(child.namedChildCount - 1);
                classDef.baseClass = resolveType(state, typeId.text);
            }
        }

        const body = node.childForFieldName('body');
        let currentAccess = node.type === 'struct_specifier' ? 'public' : 'private';
        
        if (body) {
            for (let i = 0; i < body.namedChildCount; i++) {
                const member = body.namedChild(i);
                
                if (member.type === 'access_specifier') {
                    currentAccess = member.text.replace(':', '').trim();
                    continue;
                }
                
                if (member.type === 'field_declaration' || member.type === 'declaration') {
                    const typeNode = member.childForFieldName('type');
                    if (!typeNode) continue;
                    const typeText = resolveType(state, typeNode.text).replace(/\s+/g, '');
                    const decl = member.childForFieldName('declarator');
                    if (decl) {
                        let fieldName = decl.text;
                        if (decl.type === 'array_declarator') fieldName = decl.namedChild(0).text;
                        classDef.fields.push({
                            name: fieldName,
                            type: typeText,
                            access: currentAccess,
                            offset: classDef.size
                        });
                        classDef.size += 1;
                    }
                } else if (member.type === 'function_definition') {
                    const isVirtual = member.children.some(c => c.text === 'virtual' || c.type === 'virtual_specifier' || c.type === 'virtual');
                    const declNode = member.childForFieldName('declarator');
                    const typeNode = member.childForFieldName('type');
                    let retType = resolveType(state, typeNode ? typeNode.text : 'void').replace(/\s+/g, '');
                    let funcName = "";
                    let paramsNode = null;

                    let currDecl = declNode;
                    while (currDecl && currDecl.type !== 'function_declarator' && currDecl.namedChildCount > 0) {
                        if (currDecl.type === 'reference_declarator') retType += '&';
                        if (currDecl.type === 'pointer_declarator') retType += '*';
                        currDecl = currDecl.namedChild(0);
                    }

                    if (currDecl && currDecl.type === 'function_declarator') {
                        funcName = currDecl.childForFieldName('declarator').text;
                        paramsNode = currDecl.childForFieldName('parameters');
                    } else {
                        funcName = declNode.text.split('(')[0];
                    }
                    
                    const params =[];
                    if (paramsNode) {
                        for (let p = 0; p < paramsNode.namedChildCount; p++) {
                            const param = paramsNode.namedChild(p);
                            if (param.type === 'parameter_declaration') {
                                let pType = resolveType(state, param.childForFieldName('type').text).replace(/\s+/g, '');
                                let pDecl = param.childForFieldName('declarator');
                                let pName = pDecl ? pDecl.text : '';
                                if (pName.includes('&')) { pType += '&'; pName = pName.replace('&', '').trim(); }
                                if (pName.includes('*')) { pType += '*'; pName = pName.replace('*', '').trim(); }
                                params.push({ type: pType, name: pName });
                            }
                        }
                    }
                    
                    const method = {
                        name: funcName,
                        params: params,
                        retType: retType,
                        body: member.childForFieldName('body'),
                        access: currentAccess,
                        isVirtual: isVirtual
                    };
                    
                    const originalName = nameNode.text;
                    if (funcName === originalName || funcName === className) {
                        classDef.constructors.push(method);
                    } else if (funcName === '~' + originalName || funcName === '~' + className) {
                        classDef.destructor = method;
                    } else {
                        classDef.methods[funcName] = classDef.methods[funcName] || [];
                        classDef.methods[funcName].push(method);
                    }
                }
            }
        }
        
        if (classDef.size === 0) classDef.size = 1;
        state.classes[className] = classDef;
        yield { action: 'define_class', name: className };
        return;
    }

    if (node.type === 'compound_statement') {
        const frame = currentFrame(state);
        const scope = {};
        frame.scopes.push(scope); // Enter new block scope
        
        let lastResult = undefined;
        try {
            for (let i = 0; i < node.namedChildCount; i++) {
                lastResult = yield* evaluate(node.namedChild(i), state);
                if (state.returnedValue !== undefined || lastResult === 'break' || lastResult === 'continue') break;
            }
        } finally {
            yield* cleanupScope(state, scope);
            if (frame.scopes[frame.scopes.length - 1] === scope) {
                frame.scopes.pop(); // Exit block scope
            }
        }
        return lastResult;
    }


    if (node.type === 'while_statement') {
        while (true) {
            const condition = yield* evaluate(node.childForFieldName('condition'), state);
            if (!condition) break;

            const result = yield* evaluate(node.childForFieldName('body'), state);
            if (result === 'break') break;
            if (state.returnedValue !== undefined) return;
            // 'continue' flows naturally to the next iteration
        }
        return;
    }

    if (node.type === 'do_statement') {
        while (true) {
            const result = yield* evaluate(node.childForFieldName('body'), state);
            if (result === 'break') break;
            if (state.returnedValue !== undefined) return;

            const condition = yield* evaluate(node.childForFieldName('condition'), state);
            if (!condition) break;
        }
        return;
    }

    if (node.type === 'for_statement') {
        const frame = currentFrame(state);
        const scope = {};
        frame.scopes.push(scope); // For loop initializer scope
        
        try {
            const init = node.childForFieldName('initializer');
            if (init) yield* evaluate(init, state);

            while (true) {
                const cond = node.childForFieldName('condition');
                if (cond) {
                    const conditionVal = yield* evaluate(cond, state);
                    if (!conditionVal) break;
                }

                const result = yield* evaluate(node.childForFieldName('body'), state);
                if (result === 'break') break;
                if (state.returnedValue !== undefined) {
                    return;
                }

                const update = node.childForFieldName('update');
                if (update) yield* evaluate(update, state);
            }
        } finally {
            yield* cleanupScope(state, scope);
            if (frame.scopes[frame.scopes.length - 1] === scope) {
                frame.scopes.pop();
            }
        }
        return;
    }


    if (node.type === 'break_statement') {
        yield { action: 'break' };
        return 'break';
    }

    if (node.type === 'continue_statement') {
        yield { action: 'continue' };
        return 'continue';
    }

    if (node.type === 'if_statement') {
        const condition = yield* evaluate(node.childForFieldName('condition'), state);
        if (condition) {
            return yield* evaluate(node.childForFieldName('consequence'), state);
        } else if (node.childForFieldName('alternative')) {
            return yield* evaluate(node.childForFieldName('alternative'), state);
        }
        return;
    }

        if (node.type === 'try_statement') {
        yield { action: 'enter_try' };
        const body = node.childForFieldName('body');
        
        let exceptionCaught = null;
        try {
            yield* evaluate(body, state);
        } catch (e) {
            if (e.isCppException) {
                exceptionCaught = e;
            } else {
                throw e; // Standard JS error, rethrow
            }
        }

        if (exceptionCaught) {
            let handled = false;
            for (let i = 1; i < node.namedChildCount; i++) {
                const catchClause = node.namedChild(i);
                if (catchClause.type === 'catch_clause') {
                    const paramsNode = catchClause.childForFieldName('parameters');
                    const paramDecl = paramsNode ? paramsNode.namedChild(0) : null;
                    let paramType = '...';
                    let paramName = null;
                    
                    if (paramDecl && paramDecl.type === 'parameter_declaration') {
                        paramType = paramDecl.childForFieldName('type').text;
                        const decl = paramDecl.childForFieldName('declarator');
                        if (decl) {
                            paramName = decl.text.replace(/[\*&]/g, '').trim();
                            if (decl.text.includes('&')) paramType += '&';
                            if (decl.text.includes('*')) paramType += '*';
                        }
                    } else if (paramDecl && (paramDecl.text === '...' || paramDecl.type === '...')) {
                        paramType = '...';
                    }

                    const cleanCatchType = paramType.replace(/[\*&]/g, '').trim();
                    const cleanThrowType = exceptionCaught.type.replace(/[\*&]/g, '').trim();

                    const isMatch = (paramType === '...') || 
                                    (cleanCatchType === cleanThrowType) || 
                                    isDerived(state, cleanThrowType, cleanCatchType);

                    if (isMatch) {
                        yield { action: 'catch', type: paramType, value: exceptionCaught.value };
                        
                        const frame = currentFrame(state);
                        const catchScope = {};
                        frame.scopes.push(catchScope);
                        
                        const oldException = state.currentException;
                        state.currentException = exceptionCaught;
                        
                        try {
                            if (paramName) {
                                catchScope[paramName] = { _type: paramType, address: allocate(state, exceptionCaught.value) };
                            }
                            yield* evaluate(catchClause.childForFieldName('body'), state);
                        } finally {
                            state.currentException = oldException;
                            yield* cleanupScope(state, catchScope);
                            if (frame.scopes[frame.scopes.length - 1] === catchScope) {
                                frame.scopes.pop();
                            }
                        }
                        handled = true;
                        break;
                    }
                }
            }
            if (!handled) {
                throw exceptionCaught;
            }
        }
        return;
    }

    if (node.type === 'throw_statement') {
        const argNode = node.namedChild(0);
        let val = null;
        let type = 'unknown';
        if (argNode) {
            val = yield* evaluate(argNode, state);
            type = getTypeOfNode(argNode, state);
        } else {
            // Rethrowing an active exception (throw;)
            if (!state.currentException) throwCompilerError(`throw without active exception`);
            val = state.currentException.value;
            type = state.currentException.type;
        }
        yield { action: 'throw', value: val, type: type };
        throw { isCppException: true, value: val, type: type };
    }


    if (node.type === 'preproc_include' || node.type === 'preproc_def' || node.type === 'preproc_function_def') {
        yield { action: 'skip', text: node.text.split('\n')[0] };
        return;
    }

    if (node.type === 'using_declaration') {
        if (node.children.some(c => c.text === 'namespace')) {
            const nameNode = node.children.find(c => c.type === 'identifier');
            if (nameNode) state.usingNamespaces.push(nameNode.text);
        }
        yield { action: 'skip', text: node.text.split('\n')[0] };
        return;
    }

    if (node.type === 'namespace_definition') {
        const nameNode = node.childForFieldName('name') || node.children.find(c => c.type === 'identifier' || c.type === 'namespace_identifier');
        const namespaceName = nameNode ? nameNode.text : 'anonymous';
        
        const body = node.childForFieldName('body') || node.children.find(c => c.type === 'declaration_list');
        if (body) {
            const oldPrefix = state.namespacePrefix;
            state.namespacePrefix = (oldPrefix ? oldPrefix + '::' : '') + namespaceName;
            
            for (let i = 0; i < body.namedChildCount; i++) {
                yield* evaluate(body.namedChild(i), state);
            }
            
            state.namespacePrefix = oldPrefix;
            yield { action: 'define_namespace', name: namespaceName };
        }
        return;
    }

    if (node.type === 'enum_specifier') {
        const nameNode = node.childForFieldName('name') || node.children.find(c => c.type === 'type_identifier' || c.type === 'identifier');
        const enumName = nameNode ? nameNode.text : 'anonymous';
        const isClass = node.children.some(c => c.text === 'class' || c.text === 'struct');
        
        const body = node.childForFieldName('body') || node.children.find(c => c.type === 'enumerator_list');
        if (body) {
            let currentValue = 0;
            const enumDict = {};
            for (let i = 0; i < body.namedChildCount; i++) {
                const enumerator = body.namedChild(i);
                if (enumerator.type === 'enumerator') {
                    const enumKeyNode = enumerator.childForFieldName('name') || enumerator.namedChild(0);
                    const enumKey = enumKeyNode.text;
                    const valueNode = enumerator.childForFieldName('value');
                    
                    if (valueNode) {
                        currentValue = yield* evaluate(valueNode, state);
                    }
                    enumDict[enumKey] = currentValue;
                    
                    if (!isClass) {
                        state.enumValues[enumKey] = currentValue;
                    }
                    currentValue++;
                }
            }
            state.enums[enumName] = { isClass, values: enumDict };
            yield { action: 'define_enum', name: enumName, isClass };
        }
        return;
    }

    if (node.type === 'function_definition') {
        const declNode = node.childForFieldName('declarator');
        const typeNode = node.childForFieldName('type');
        let retType = resolveType(state, typeNode ? typeNode.text : 'void').replace(/\s+/g, '');
        let funcName = "";
        let paramsNode = null;

        let currDecl = declNode;
        while (currDecl && currDecl.type !== 'function_declarator' && currDecl.namedChildCount > 0) {
            if (currDecl.type === 'reference_declarator') retType += '&';
            if (currDecl.type === 'pointer_declarator') retType += '*';
            currDecl = currDecl.namedChild(0);
        }

        if (currDecl && currDecl.type === 'function_declarator') {
            const dNode = currDecl.childForFieldName('declarator');
            funcName = dNode ? dNode.text : "unknown";
            paramsNode = currDecl.childForFieldName('parameters');
        } else {
            funcName = declNode.text.split('(')[0];
        }

        if (state.namespacePrefix) {
            funcName = state.namespacePrefix + '::' + funcName;
        }

        if (state.instantiatingTemplateName) {
            funcName = state.instantiatingTemplateName;
        }

        const params =[];
        if (paramsNode) {
            for (let i = 0; i < paramsNode.namedChildCount; i++) {
                const param = paramsNode.namedChild(i);
                if (param.type === 'parameter_declaration') {
                    let typeText = resolveType(state, param.childForFieldName('type').text).replace(/\s+/g, '');
                    let declChild = param.childForFieldName('declarator');
                    let declText = declChild ? declChild.text : '';
                    if (declText.includes('&')) { typeText += '&'; declText = declText.replace('&', '').trim(); }
                    if (declText.includes('*')) { typeText += '*'; declText = declText.replace('*', '').trim(); }
                    params.push({
                        type: typeText,
                        name: declText
                    });
                }
            }
        }

        state.functions[funcName] = state.functions[funcName] || [];
        state.functions[funcName].push({
            name: funcName,
            params: params,
            retType: retType,
            body: node.childForFieldName('body'),
            templateArgs: state.templateArgs ? { ...state.templateArgs } : null
        });

        yield { action: 'define_function', name: funcName, params };

        if (funcName === 'main') {
            const frame = { name: 'main', scopes: [{}] };
            state.callStack.push(frame);
            yield { action: 'enter_frame', name: 'main' };
            let result;
            try {
                result = yield* evaluate(node.childForFieldName('body'), state);
            } catch (e) {
                if (e.isCppException) {
                    throwCompilerError(`terminate called after throwing an instance of '${e.type}' (Value: ${e.value})`);
                }
                throw e;
            } finally {
                if (state.callStack[state.callStack.length - 1] === frame) {
                    state.callStack.pop();
                }
            }
            return result;
        }
        return;
    }

    // --- 2. FUNCTION CALLS ---
    if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');

        let funcName;
        let isMethod = false;
        let isTempObject = false;
        let isDynamicDispatchPossible = false;
        let objAddr, objType, className;

        if (funcNode.type === 'field_expression') {
            isMethod = true;
            const argNode = funcNode.childForFieldName('argument') || funcNode.namedChild(0);
            funcName = funcNode.childForFieldName('field').text;
            
            const isPointer = funcNode.children.some(c => c.type === '->');
            if (isPointer) {
                objAddr = yield* evaluate(argNode, state);
                objType = getTypeOfNode(argNode, state);
                isDynamicDispatchPossible = true;
            } else {
                objAddr = yield* evaluateLValue(argNode, state);
                objType = getTypeOfNode(argNode, state);
                if (objType && objType.includes('&')) {
                    isDynamicDispatchPossible = true;
                }
            }
            if (!objType || objType === 'unknown') throwCompilerError(`cannot determine type for method call '${funcName}'`);
            className = objType.replace(/[\*&]/g, '');
        } else if (funcNode.type === 'qualified_identifier') {
            funcName = funcNode.childForFieldName('scope').text + "::" + funcNode.childForFieldName('name').text;
        } else if (funcNode.type === 'template_function') {
            const nameNode = funcNode.childForFieldName('name') || funcNode.namedChild(0);
            const tmplArgsNode = funcNode.childForFieldName('arguments') || funcNode.namedChild(1);
            const rawName = nameNode.text;
            funcName = funcNode.text.replace(/\s+/g, ''); // e.g. add<int>
            
            const tmpl = state.templates && state.templates[rawName];
            if (tmpl && !tmpl.isClass && !state.functions[funcName]) {
                // Instantiate function template
                const typeArgs = [];
                for (let i = 0; i < tmplArgsNode.namedChildCount; i++) {
                    const arg = tmplArgsNode.namedChild(i);
                    if (arg.type !== '<' && arg.type !== '>' && arg.type !== ',') {
                        typeArgs.push(resolveType(state, arg.text).replace(/\s+/g, ''));
                    }
                }
                const oldTemplateArgs = state.templateArgs;
                state.templateArgs = { ...(state.templateArgs || {}) };
                tmpl.templateParams.forEach((param, i) => {
                    state.templateArgs[param] = typeArgs[i] || 'int';
                });
                
                const oldName = state.instantiatingTemplateName;
                state.instantiatingTemplateName = funcName;
                yield { action: 'instantiate_template', name: funcName };
                yield* evaluate(tmpl.astNode, state);
                
                state.instantiatingTemplateName = oldName;
                state.templateArgs = oldTemplateArgs;
            }
        } else {
            funcName = funcNode.text;
            const entry = findVar(state, funcName);
            if (entry && entry.isObject) {
                isMethod = true;
                objAddr = entry.address;
                className = entry.className;
                funcName = 'operator()'; // Map to functor operator
            }
        }

        if (funcName === 'cout' || funcName === 'std::cout') return;

        let targetFuncDef = null;
        let possibleMatches = [];

        if (isMethod) {
            const cls = getClassDef(state, className);
            if (!cls) throwCompilerError(`unknown class '${className}'`);
            
            const methods = cls.flattenedMethods[funcName] ||[];
            methods.forEach(m => possibleMatches.push(m));
        } else {
            const cls = getClassDef(state, funcName);
            if (cls) {
                isTempObject = true;
                className = funcName;
                possibleMatches = cls.constructors || [];
            } else {
                Object.values(state.functions).flat().forEach(f => {
                    if (f.name === funcName) possibleMatches.push(f);
                    state.usingNamespaces.forEach(ns => {
                        if (f.name === ns + '::' + funcName) possibleMatches.push(f);
                    });
                });
            }
        }

        // Resolve Overloading
        const numArgs = (argsNode && argsNode.type === 'argument_list') ? argsNode.namedChildCount : 0;
        possibleMatches = possibleMatches.filter(m => m.params.length === numArgs);

        if (!isTempObject && possibleMatches.length === 0) {
            throwCompilerError(`use of undeclared function '${funcName}'`);
        }

        if (!isTempObject && possibleMatches.length === 0) {
            throwCompilerError(`no matching function for call to '${funcName}' with ${numArgs} arguments`);
        } else if (possibleMatches.length === 1) {
            targetFuncDef = possibleMatches[0];
        } else {
            let bestMatch = possibleMatches[0];
            let maxScore = -1;
            for (let m of possibleMatches) {
                let score = 0;
                for (let i = 0; i < numArgs; i++) {
                    const argNode = argsNode.namedChild(i);
                    const argType = getTypeOfNode(argNode, state).replace(/[\*&]/g, '');
                    const paramType = m.params[i].type.replace(/[\*&]/g, '');
                    if (argType === paramType) score += 2;
                }
                if (score > maxScore) {
                    maxScore = score;
                    bestMatch = m;
                }
            }
            targetFuncDef = bestMatch;
        }

        if (isMethod && targetFuncDef && targetFuncDef.isVirtual && isDynamicDispatchPossible) {
            const dynamicClassName = state.dynamicTypes[objAddr];
            if (dynamicClassName && dynamicClassName !== className) {
                const dynCls = getClassDef(state, dynamicClassName);
                if (dynCls) {
                    const dynMethods = dynCls.flattenedMethods[funcName] || [];
                    const dynMatch = dynMethods.find(m => {
                        if (m.params.length !== targetFuncDef.params.length) return false;
                        for (let i = 0; i < m.params.length; i++) {
                            if (m.params[i].type.replace(/[\*&]/g, '') !== targetFuncDef.params[i].type.replace(/[\*&]/g, '')) return false;
                        }
                        return true;
                    });
                    if (dynMatch) {
                        targetFuncDef = dynMatch;
                        className = dynamicClassName;
                    }
                }
            }
        }

        if (isMethod && targetFuncDef) {
            const frame = currentFrame(state);
            if (targetFuncDef.access === 'private' && frame.methodOf !== className) {
                throwCompilerError(`'${funcName}' is a private method of '${className}'`);
            } else if (targetFuncDef.access === 'protected' && frame.methodOf !== className && !isDerived(state, frame.methodOf, className)) {
                throwCompilerError(`'${funcName}' is a protected method of '${className}'`);
            }
        }

        const evaluatedArgs =[];
        if (argsNode && argsNode.type === 'argument_list') {
            for (let i = 0; i < argsNode.namedChildCount; i++) {
                const argNode = argsNode.namedChild(i);
                const param = targetFuncDef ? targetFuncDef.params[i] : null;
                if (param && param.type.includes('&')) {
                    evaluatedArgs.push(yield* evaluateLValue(argNode, state));
                } else {
                    evaluatedArgs.push(yield* evaluate(argNode, state));
                }
            }
        }

        if (isTempObject) {
            const cls = getClassDef(state, className);
            const tempAddr = allocate(state, null, cls.totalSize);
            yield { action: 'allocate_temp', type: className, address: tempAddr };
            yield* callConstructors(state, className, tempAddr, evaluatedArgs);
            return tempAddr;
        }

        if (isMethod) {
            return yield* callMethod(state, targetFuncDef, objAddr, className, evaluatedArgs);
        }

        const funcDef = targetFuncDef;
        const newFrame = { name: funcName, scopes:[{}], retType: funcDef.retType };

        funcDef.params.forEach((param, index) => {
            const isRef = param.type.includes('&');
            let addr = isRef ? evaluatedArgs[index] : allocate(state, evaluatedArgs[index]);
            newFrame.scopes[0][param.name] = { _type: param.type, address: addr };
        });

        yield { action: 'call_function', name: funcName, args: evaluatedArgs };

        state.callStack.push(newFrame);
        const oldRet = state.returnedValue;
        state.returnedValue = undefined;
        const oldTemplateArgs = state.templateArgs;
        if (funcDef.templateArgs) {
            state.templateArgs = funcDef.templateArgs;
        }

        let result;
        try {
            yield* evaluate(funcDef.body, state);
            result = state.returnedValue;
            yield { action: 'return_from_function', name: funcName, value: result };
        } finally {
            state.templateArgs = oldTemplateArgs;
            state.returnedValue = oldRet;
            if (state.callStack[state.callStack.length - 1] === newFrame) {
                state.callStack.pop();
            }
        }
        return result;
    }


    if (node.type === 'return_statement') {
        const frame = currentFrame(state);
        let isRefReturn = false;
        
        if (frame && frame.retType && frame.retType.includes('&')) {
            isRefReturn = true;
        }

        const argNode = node.namedChild(0);
        const val = isRefReturn ? yield* evaluateLValue(argNode, state) : yield* evaluate(argNode, state);
        
        state.returnedValue = val; // Store it in state so the compound_statement stops
        yield { action: 'return', value: val };
        return val;
    }

    // --- 3. VARIABLES & MEMORY ---
    if (node.type === 'declaration') {
        const typeNode = node.childForFieldName('type');
        let baseType = typeNode ? resolveType(state, typeNode.text).replace(/\s+/g, '') : 'auto';
        
        yield* instantiateClassTemplateIfNeeded(state, baseType);
        
        const isConstDecl = node.children.some(c => c.type === 'type_qualifier' && c.text === 'const');

        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child === typeNode || child.type === 'primitive_type' || child.type === 'type_identifier' || child.type === 'storage_class_specifier' || child.type === 'type_qualifier' || child.type === 'template_type') continue;

            let declNode = child;
            let valNode = null;
            if (declNode.type === 'init_declarator') {
                valNode = declNode.childForFieldName('value');
                declNode = declNode.childForFieldName('declarator');
            }

            let currentType = baseType;
            let isArray = false;
            let sizeNode = null;
            let isRef = false;
            let name = "";

            let curr = declNode;
            while (curr) {
                if (curr.type === 'pointer_declarator') {
                    currentType += '*';
                    curr = curr.childForFieldName('declarator') || curr.namedChild(0);
                } else if (curr.type === 'reference_declarator') {
                    currentType += '&';
                    isRef = true;
                    curr = curr.childForFieldName('declarator') || curr.namedChild(0);
                } else if (curr.type === 'array_declarator') {
                    isArray = true;
                    for (let c = 0; c < curr.namedChildCount; c++) {
                        const childC = curr.namedChild(c);
                        if (childC.type !== 'identifier' && childC.type !== 'array_declarator') {
                            sizeNode = childC;
                            break;
                        }
                    }
                    curr = curr.childForFieldName('declarator') || curr.namedChild(0);
                } else if (curr.type === 'identifier') {
                    name = curr.text;
                    if (state.namespacePrefix) name = state.namespacePrefix + '::' + name;
                    break;
                } else {
                    name = curr.text;
                    break;
                }
            }

            const frame = currentFrame(state);
            const currentScope = frame.scopes[frame.scopes.length - 1];
            const cls = getClassDef(state, currentType);

            if (isRef) {
                if (!valNode) throwCompilerError(`reference variable '${name}' requires an initializer`);
                const lval = yield* evaluateLValue(valNode, state);
                currentScope[name] = { _type: currentType, address: lval, isConst: isConstDecl };
                yield { action: 'declare_var', type: currentType + (isConstDecl ? ' const' : ''), name, value: readMem(state, lval), address: lval };
            } else if (isArray) {
                let size = 0;
                if (sizeNode) size = yield* evaluate(sizeNode, state);
                
                let initValues =[];
                if (valNode && valNode.type === 'initializer_list') {
                    for (let j = 0; j < valNode.namedChildCount; j++) {
                        initValues.push(yield* evaluate(valNode.namedChild(j), state));
                    }
                    if (size === 0) size = initValues.length;
                } else if (valNode && valNode.type === 'string_literal') {
                    const str = valNode.text.replace(/"/g, '');
                    for (let j = 0; j < str.length; j++) initValues.push(str.charCodeAt(j));
                    initValues.push(0);
                    if (size === 0) size = initValues.length;
                }
                
                const addr = allocate(state, initValues, size || 1);
                currentScope[name] = { _type: currentType, address: addr, isArray: true, isConst: isConstDecl };
                yield { action: 'declare_var', type: currentType + `[${size || initValues.length}]`, name, value: `[Array at 0x${addr.toString(16)}]`, address: addr, isArray: true };
            } else if (cls) {
                const addr = allocate(state, null, cls.totalSize);
                state.dynamicTypes[addr] = currentType;
                currentScope[name] = { _type: currentType, address: addr, isObject: true, className: currentType, isConst: isConstDecl };
                yield { action: 'declare_obj', type: currentType + (isConstDecl ? ' const' : ''), name, address: addr };
                
                const evaluatedArgs =[];
                if (valNode && valNode.type === 'argument_list') {
                    for (let j = 0; j < valNode.namedChildCount; j++) {
                        evaluatedArgs.push(yield* evaluate(valNode.namedChild(j), state));
                    }
                    yield* callConstructors(state, currentType, addr, evaluatedArgs);
                } else if (valNode) {
                    const srcAddr = yield* evaluate(valNode, state);
                    for (let k = 0; k < cls.totalSize; k++) {
                        writeMem(state, addr + k, readMem(state, srcAddr + k));
                    }
                } else {
                    yield* callConstructors(state, currentType, addr, []);
                }
            } else {
                let val = null;
                if (valNode) val = yield* evaluate(valNode, state);
                const addr = allocate(state, val);
                currentScope[name] = { _type: currentType, address: addr, isConst: isConstDecl };
                yield { action: 'declare_var', type: currentType + (isConstDecl ? ' const' : ''), name, value: val, address: addr };
            }
        }
        return;
    }

    if (node.type === 'new_expression') {
        const typeNode = node.childForFieldName('type');
        let typeName = resolveType(state, typeNode.text).replace(/\s+/g, '');
        
        yield* instantiateClassTemplateIfNeeded(state, typeName);
        
        let size = 1;
        const cls = getClassDef(state, typeName);
        if (cls) size = cls.totalSize;

        const declaratorNode = node.childForFieldName('declarator');
        if (declaratorNode && declaratorNode.type === 'new_declarator') {
            for (let i = 0; i < declaratorNode.namedChildCount; i++) {
                const child = declaratorNode.namedChild(i);
                if (child.type !== 'type_identifier' && child.type !== 'primitive_type') {
                    size = yield* evaluate(child, state);
                    break;
                }
            }
        }
        
        const argsNode = node.childForFieldName('arguments');
        const evaluatedArgs =[];
        if (argsNode && argsNode.type === 'argument_list') {
             for (let i = 0; i < argsNode.namedChildCount; i++) {
                 evaluatedArgs.push(yield* evaluate(argsNode.namedChild(i), state));
             }
        }
        
        const addr = allocate(state, null, size);
        yield { action: 'heap_allocate', address: addr, size };

        if (cls) {
            state.dynamicTypes[addr] = typeName;
            yield* callConstructors(state, typeName, addr, evaluatedArgs);
        } else if (evaluatedArgs.length === 1) {
            writeMem(state, addr, evaluatedArgs[0]);
        }

        return addr;
    }

    if (node.type === 'delete_expression') {
        const ptrNode = node.namedChild(node.namedChildCount - 1);
        const addr = yield* evaluate(ptrNode, state);
        
        const ptrType = getTypeOfNode(ptrNode, state);
        if (ptrType) {
            let className = ptrType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls && cls.destructor && cls.destructor.isVirtual) {
                const dynamicClassName = state.dynamicTypes[addr];
                if (dynamicClassName) {
                    className = dynamicClassName;
                }
            }
            yield* callDestructors(state, className, addr);
        }

        yield { action: 'heap_free', address: addr };
        return;
    }

    if (node.type === 'assignment_expression') {
        const leftNode = node.childForFieldName('left');
        const rightNode = node.childForFieldName('right');
        const operator = node.childForFieldName('operator') ? node.childForFieldName('operator').text : '=';
        
        if (leftNode.type === 'identifier') {
            const entry = findVar(state, leftNode.text);
            if (entry && entry.isConst) throwCompilerError(`cannot assign to variable '${leftNode.text}' with const-qualified type`);
        } else if (leftNode.type === 'qualified_identifier') {
            const fullName = leftNode.childForFieldName('scope').text + "::" + leftNode.childForFieldName('name').text;
            const entry = findVar(state, fullName);
            if (entry && entry.isConst) throwCompilerError(`cannot assign to variable '${fullName}' with const-qualified type`);
        }

        const leftType = getTypeOfNode(leftNode, state);
        if (leftType && leftType !== 'unknown') {
            const className = leftType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls) {
                const funcName = 'operator' + operator;
                const methods = cls.flattenedMethods[funcName] || [];
                if (methods.length > 0) {
                    const targetFuncDef = methods[0];
                    const evaluatedArgs = [];
                    const param = targetFuncDef.params[0];
                    if (param && param.type.includes('&')) {
                        evaluatedArgs.push(yield* evaluateLValue(rightNode, state));
                    } else {
                        evaluatedArgs.push(yield* evaluate(rightNode, state));
                    }
                    const objAddr = yield* evaluateLValue(leftNode, state);
                    return yield* callMethod(state, targetFuncDef, objAddr, className, evaluatedArgs);
                } else if (operator === '=') {
                    const lval = yield* evaluateLValue(leftNode, state);
                    const rightVal = yield* evaluate(rightNode, state);
                    for (let i = 0; i < cls.totalSize; i++) {
                        writeMem(state, lval + i, readMem(state, rightVal + i));
                    }
                    yield { action: 'assign_var', text: node.text, address: lval, value: `<object copy ${className}>` };
                    return lval;
                }
            }
        }

        const lval = yield* evaluateLValue(leftNode, state);
        const rightVal = yield* evaluate(rightNode, state);
        writeMem(state, lval, rightVal);
        yield { action: 'assign_var', text: node.text, address: lval, value: rightVal };
        return rightVal;
    }

    if (node.type === 'update_expression') {
        const isPrefix = node.children[0].type === '++' || node.children[0].type === '--';
        const operatorNode = isPrefix ? node.children[0] : node.children[node.children.length - 1];
        const operator = operatorNode.type;
        const argNode = node.childForFieldName('argument') || node.namedChild(0);
        const funcName = 'operator' + operator;

        const argType = getTypeOfNode(argNode, state);
        if (argType && argType !== 'unknown') {
            const className = argType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls) {
                const methods = cls.flattenedMethods[funcName] || [];
                if (methods.length > 0) {
                    let targetFuncDef = methods.find(m => isPrefix ? m.params.length === 0 : m.params.length === 1);
                    if (!targetFuncDef) targetFuncDef = methods[0];
                    const objAddr = yield* evaluateLValue(argNode, state);
                    const evaluatedArgs = targetFuncDef.params.length > 0 ? [0] : [];
                    return yield* callMethod(state, targetFuncDef, objAddr, className, evaluatedArgs);
                }
            }
        }

        if (state.functions[funcName]) {
            const possible = state.functions[funcName].filter(f => isPrefix ? f.params.length === 1 : f.params.length === 2);
            if (possible.length > 0) {
                const targetFuncDef = possible[0];
                const param = targetFuncDef.params[0];
                const evaluatedArg = param && param.type.includes('&') ? yield* evaluateLValue(argNode, state) : yield* evaluate(argNode, state);
                const evaluatedArgs = isPrefix ? [evaluatedArg] : [evaluatedArg, 0];
                
                const newFrame = { name: funcName, scopes:[{}], retType: targetFuncDef.retType };
                targetFuncDef.params.forEach((p, index) => {
                    const isRef = p.type.includes('&');
                    let addr = isRef ? evaluatedArgs[index] : allocate(state, evaluatedArgs[index]);
                    newFrame.scopes[0][p.name] = { _type: p.type, address: addr };
                });

                yield { action: 'call_function', name: funcName, args: evaluatedArgs };
                state.callStack.push(newFrame);
                const oldRet = state.returnedValue;
                state.returnedValue = undefined;
                
                let result;
                try {
                    yield* evaluate(targetFuncDef.body, state);
                    result = state.returnedValue;
                    yield { action: 'return_from_function', name: funcName, value: result };
                } finally {
                    state.returnedValue = oldRet;
                    if (state.callStack[state.callStack.length - 1] === newFrame) {
                        state.callStack.pop();
                    }
                }
                return result;
            }
        }

        if (argNode.type === 'identifier') {
            const entry = findVar(state, argNode.text);
            if (entry && entry.isConst) throwCompilerError(`cannot modify const variable '${argNode.text}'`);
        } else if (argNode.type === 'qualified_identifier') {
            const fullName = argNode.childForFieldName('scope').text + "::" + argNode.childForFieldName('name').text;
            const entry = findVar(state, fullName);
            if (entry && entry.isConst) throwCompilerError(`cannot modify const variable '${fullName}'`);
        }

        const lval = yield* evaluateLValue(argNode, state);
        const oldVal = readMem(state, lval);
        const newVal = (operator === '++') ? oldVal + 1 : oldVal - 1;

        writeMem(state, lval, newVal);
        yield { action: 'update_var', text: node.text, address: lval, operator, value: newVal, isPrefix };
        return isPrefix ? newVal : oldVal;
    }

    // --- 4. EXPRESSIONS, MATH, LITERALS ---
    if (node.type === 'expression_statement') return yield* evaluate(node.namedChild(0), state);
    if (node.type === 'condition_clause' || node.type === 'parenthesized_expression' || node.type === 'subscript_argument_list') return yield* evaluate(node.namedChild(0), state);
    if (node.type === 'number_literal') {
        const txt = node.text.toLowerCase();
        return txt.includes('.') ? parseFloat(txt) : parseInt(txt);
    }
    if (node.type === 'string_literal') return node.text.replace(/"/g, '');
    if (node.type === 'true') return 1;
    if (node.type === 'false') return 0;
    
    if (node.type === 'this') {
        const entry = findVar(state, 'this');
        if (!entry) throwCompilerError(`invalid use of 'this' outside of a non-static member function`);
        const val = readMem(state, entry.address);
        yield { action: 'read_var', name: 'this', value: `0x${val.toString(16)}` };
        return val;
    }

    if (node.type === 'field_expression') {
        const addr = yield* evaluateLValue(node, state);
        const fieldType = getTypeOfNode(node, state);
        const className = fieldType ? fieldType.replace(/[\*&]/g, '') : null;
        const cls = className ? getClassDef(state, className) : null;
        
        if (cls) {
            yield { action: 'read_var', name: node.text, value: `<object ${className} at 0x${addr.toString(16)}>` };
            return addr;
        }

        const val = readMem(state, addr);
        yield { action: 'read_var', name: node.text, value: val };
        return val;
    }

    if (node.type === 'subscript_expression') {
        const argNode = node.childForFieldName('argument') || node.namedChild(0);
        const indexNode = node.childForFieldName('indices') || node.childForFieldName('index') || node.namedChild(1);

        const argType = getTypeOfNode(argNode, state);
        if (argType && argType !== 'unknown') {
            const className = argType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls) {
                const methods = cls.flattenedMethods['operator[]'] || [];
                if (methods.length > 0) {
                    const targetFuncDef = methods[0];
                    const objAddr = yield* evaluateLValue(argNode, state);
                    const param = targetFuncDef.params[0];
                    const evaluatedArgs = [];
                    evaluatedArgs.push(param && param.type.includes('&') ? yield* evaluateLValue(indexNode, state) : yield* evaluate(indexNode, state));
                    
                    const retAddr = yield* callMethod(state, targetFuncDef, objAddr, className, evaluatedArgs);
                    const val = readMem(state, retAddr);
                    yield { action: 'read_var', name: node.text, value: val };
                    return val;
                }
            }
        }

        const addr = yield* evaluateLValue(node, state);
        const val = readMem(state, addr);
        yield { action: 'read_array', text: node.text, address: addr, value: val };
        return val;
    }

    if (node.type === 'qualified_identifier') {
        const scopeNode = node.childForFieldName('scope') || node.namedChild(0);
        const nameNode = node.childForFieldName('name') || node.namedChild(node.namedChildCount - 1);
        const scopeText = scopeNode.text;
        const nameText = nameNode.text;

        if (state.enums[scopeText] && nameText in state.enums[scopeText].values) {
            return state.enums[scopeText].values[nameText];
        }

        const fullName = scopeText + "::" + nameText;
        const entry = findVar(state, fullName);
        if (entry) {
            const val = readMem(state, entry.address);
            yield { action: 'read_var', name: fullName, value: val };
            return val;
        }

        return fullName;
    }

    if (node.type === 'identifier') {
        if (node.text === 'cout' || node.text === 'endl' || node.text === 'std::cout') return node.text;

        if (node.text in state.enumValues) {
            return state.enumValues[node.text];
        }

        const entry = findVar(state, node.text);
        if (!entry) throwCompilerError(`use of undeclared identifier '${node.text}'`);

        if (entry.isArray) {
            yield { action: 'read_var', name: node.text, value: `<array at 0x${entry.address.toString(16)}>` };
            return entry.address;
        }

        if (entry.isObject) {
            yield { action: 'read_var', name: node.text, value: `<object ${entry.className} at 0x${entry.address.toString(16)}>` };
            return entry.address;
        }

        const val = readMem(state, entry.address);
        yield { action: 'read_var', name: node.text, value: val };
        return val;
    }

    if (node.type === 'binary_expression') {
        const leftNode = node.childForFieldName('left');
        const rightNode = node.childForFieldName('right');
        const operator = node.childForFieldName('operator') ? node.childForFieldName('operator').text : node.children[1].text;
        const funcName = 'operator' + operator;

        const leftType = getTypeOfNode(leftNode, state);
        const rightType = getTypeOfNode(rightNode, state);
        
        const isLeftClass = leftType && leftType !== 'unknown' && getClassDef(state, leftType.replace(/[\*&]/g, ''));
        const isRightClass = rightType && rightType !== 'unknown' && getClassDef(state, rightType.replace(/[\*&]/g, ''));

        if (isLeftClass) {
            const className = leftType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls) {
                const methods = cls.flattenedMethods[funcName] || [];
                if (methods.length > 0) {
                    const targetFuncDef = methods[0];
                    const evaluatedArgs = [];
                    const param = targetFuncDef.params[0];
                    if (param && param.type.includes('&')) {
                        evaluatedArgs.push(yield* evaluateLValue(rightNode, state));
                    } else {
                        evaluatedArgs.push(yield* evaluate(rightNode, state));
                    }
                    const objAddr = yield* evaluateLValue(leftNode, state);
                    return yield* callMethod(state, targetFuncDef, objAddr, className, evaluatedArgs);
                }
            }
        }

        if ((isLeftClass || isRightClass) && state.functions[funcName]) {
            const possible = state.functions[funcName].filter(f => f.params.length === 2);
            if (possible.length > 0) {
                const targetFuncDef = possible[0];
                const evaluatedArgs = [];
                const param1 = targetFuncDef.params[0];
                evaluatedArgs.push(param1 && param1.type.includes('&') ? yield* evaluateLValue(leftNode, state) : yield* evaluate(leftNode, state));
                const param2 = targetFuncDef.params[1];
                evaluatedArgs.push(param2 && param2.type.includes('&') ? yield* evaluateLValue(rightNode, state) : yield* evaluate(rightNode, state));
                
                const newFrame = { name: funcName, scopes:[{}], retType: targetFuncDef.retType };
                targetFuncDef.params.forEach((param, index) => {
                    const isRef = param.type.includes('&');
                    let addr = isRef ? evaluatedArgs[index] : allocate(state, evaluatedArgs[index]);
                    newFrame.scopes[0][param.name] = { _type: param.type, address: addr };
                });

                yield { action: 'call_function', name: funcName, args: evaluatedArgs };
                state.callStack.push(newFrame);
                const oldRet = state.returnedValue;
                state.returnedValue = undefined;
                yield* evaluate(targetFuncDef.body, state);
                const result = state.returnedValue;
                state.returnedValue = oldRet;
                state.callStack.pop();
                yield { action: 'return_from_function', name: funcName, value: result };
                return result;
            }
        }

        const left = yield* evaluate(leftNode, state);

        if (operator === '&&') {
            if (!left) {
                yield { action: 'short_circuit', operator: '&&', leftValue: left, result: 0 };
                return 0;
            }
            const right = yield* evaluate(rightNode, state);
            const res = (left && right) ? 1 : 0;
            yield { action: 'calculate', text: `${left} && ${right}`, value: res };
            return res;
        }

        if (operator === '||') {
            if (left) {
                yield { action: 'short_circuit', operator: '||', leftValue: left, result: 1 };
                return 1;
            }
            const right = yield* evaluate(rightNode, state);
            const res = (left || right) ? 1 : 0;
            yield { action: 'calculate', text: `${left} || ${right}`, value: res };
            return res;
        }

        const right = yield* evaluate(rightNode, state);

        if (operator === '<<') {
            if (left === 'cout') {
                const printVal = right === 'endl' ? '\n' : right;
                yield { action: 'print', value: printVal };
                return left;
            }
            yield { action: 'calculate', text: `${left} << ${right}`, value: left << right };
            return left << right;
        }

        let result;
        switch (operator) {
            case '+': result = left + right; break;
            case '-': result = left - right; break;
            case '*': result = left * right; break;
            case '/': result = Math.trunc(left / right); break;
            case '%': result = left % right; break;
            case '&': result = left & right; break;
            case '|': result = left | right; break;
            case '^': result = left ^ right; break;
            case '>>': result = left >> right; break;
            case '==': result = left === right ? 1 : 0; break;
            case '!=': result = left !== right ? 1 : 0; break;
            case '<': result = left < right ? 1 : 0; break;
            case '>': result = left > right ? 1 : 0; break;
            case '<=': result = left <= right ? 1 : 0; break;
            case '>=': result = left >= right ? 1 : 0; break;
            default: throwCompilerError(`unsupported binary operator '${operator}'`);
        }

        yield { action: 'calculate', text: `${left} ${operator} ${right}`, value: result };
        return result;
    }

    if (node.type === 'unary_expression' || node.type === 'pointer_expression' || node.type === 'reference_expression' || node.type === 'address_expression') {
        const operator = node.childForFieldName('operator') ? node.childForFieldName('operator').text : node.children[0].text;
        const argNode = node.childForFieldName('argument') || node.children[node.children.length - 1];
        const funcName = 'operator' + operator;

        const argType = getTypeOfNode(argNode, state);
        if (argType && argType !== 'unknown' && operator !== '&' && operator !== '*') {
            const className = argType.replace(/[\*&]/g, '');
            const cls = getClassDef(state, className);
            if (cls) {
                const methods = cls.flattenedMethods[funcName] || [];
                if (methods.length > 0) {
                    const targetFuncDef = methods[0];
                    const objAddr = yield* evaluateLValue(argNode, state);
                    return yield* callMethod(state, targetFuncDef, objAddr, className, []);
                }
            }
        }

        if (operator !== '&' && operator !== '*' && state.functions[funcName]) {
            const possible = state.functions[funcName].filter(f => f.params.length === 1);
            if (possible.length > 0) {
                const targetFuncDef = possible[0];
                const param = targetFuncDef.params[0];
                const evaluatedArg = param && param.type.includes('&') ? yield* evaluateLValue(argNode, state) : yield* evaluate(argNode, state);
                
                const newFrame = { name: funcName, scopes:[{}], retType: targetFuncDef.retType };
                const isRef = param.type.includes('&');
                let addr = isRef ? evaluatedArg : allocate(state, evaluatedArg);
                newFrame.scopes[0][param.name] = { _type: param.type, address: addr };

                yield { action: 'call_function', name: funcName, args: [evaluatedArg] };
                state.callStack.push(newFrame);
                const oldRet = state.returnedValue;
                state.returnedValue = undefined;
                
                let result;
                try {
                    yield* evaluate(targetFuncDef.body, state);
                    result = state.returnedValue;
                    yield { action: 'return_from_function', name: funcName, value: result };
                } finally {
                    state.returnedValue = oldRet;
                    if (state.callStack[state.callStack.length - 1] === newFrame) {
                        state.callStack.pop();
                    }
                }
                return result;
            }
        }

        if (operator === '&') {
            const lval = yield* evaluateLValue(argNode, state);
            yield { action: 'address_of', text: node.text, value: lval };
            return lval;
        }
        if (operator === '*') {
            const addr = yield* evaluate(argNode, state);
            const val = readMem(state, addr);
            yield { action: 'dereference', text: node.text, address: addr, value: val };
            return val;
        }

        const operand = yield* evaluate(argNode, state);

        let result;
        switch (operator) {
            case '~': result = ~operand; break;
            case '-': result = -operand; break;
            case '+': result = +operand; break;
            case '!': result = !operand ? 1 : 0; break;
            default: throwCompilerError(`unsupported unary operator '${operator}'`);
        }

        yield { action: 'calculate', text: `${operator}${operand}`, value: result };
        return result;
    }
}

module.exports = { evaluate };
