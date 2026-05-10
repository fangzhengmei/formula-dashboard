const MATH_FUNCTIONS = ['abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'exp', 'floor', 'log', 'max', 'min', 'pow', 'round', 'sin', 'sqrt', 'tan'];
const MATH_CONSTANTS = ['PI', 'E'];
const RESERVED_WORDS = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'];

function isMathFunction(name) {
    return MATH_FUNCTIONS.some(f => f.toLowerCase() === name.toLowerCase());
}

function isMathConstant(name) {
    return MATH_CONSTANTS.some(c => c.toLowerCase() === name.toLowerCase());
}

function isReservedWord(name) {
    return RESERVED_WORDS.some(w => w.toLowerCase() === name.toLowerCase());
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getBoundaryRegex(name, flags = 'g') {
    const escaped = escapeRegExp(name);
    return new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${escaped}(?=[^\\p{L}\\p{N}_]|$)`, flags + 'u');
}

function getBoundaryRegexCaseInsensitive(name) {
    const escaped = escapeRegExp(name);
    return new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${escaped}(?=[^\\p{L}\\p{N}_]|$)`, 'gui');
}

function hasBoundaryMatch(formula, name) {
    const regex = getBoundaryRegexCaseInsensitive(name);
    return regex.test(formula);
}

function stripMathPrefix(formula) {
    return formula.replace(/Math\./gi, '');
}

function replaceWithBoundary(formula, name, replacement) {
    const regex = getBoundaryRegex(name);
    return formula.replace(regex, replacement);
}

function replaceWithBoundaryCaseInsensitive(formula, name, replacement) {
    const regex = getBoundaryRegexCaseInsensitive(name);
    let result = formula;
    let match;
    while ((match = regex.exec(result)) !== null) {
        const before = result.slice(0, match.index);
        const after = result.slice(match.index + match[0].length);
        result = before + replacement + after;
        regex.lastIndex = 0;
    }
    return result;
}

function replaceAllWithBoundary(formula, name, replacement) {
    let result = formula;
    const regex = getBoundaryRegex(name);
    let match;
    while ((match = regex.exec(result)) !== null) {
        const before = result.slice(0, match.index);
        const after = result.slice(match.index + name.length);
        result = before + replacement + after;
        regex.lastIndex = 0;
    }
    return result;
}

function replaceMathFunctionsAndConstants(formula) {
    let result = stripMathPrefix(formula);
    
    const allMathNames = [...MATH_FUNCTIONS, ...MATH_CONSTANTS]
        .sort((a, b) => b.length - a.length);
    
    for (const name of allMathNames) {
        result = replaceWithBoundaryCaseInsensitive(result, name, ' '.repeat(name.length));
    }
    
    return result;
}

export function extractVariableNames(formula, allMetrics = []) {
    let remaining = replaceMathFunctionsAndConstants(formula);
    
    const metricNames = allMetrics.map(m => m.name);
    const sortedNames = [...metricNames].sort((a, b) => b.length - a.length);
    
    const found = new Set();
    
    for (const name of sortedNames) {
        if (!name) continue;
        if (hasBoundaryMatch(remaining, name)) {
            found.add(name);
            remaining = replaceAllWithBoundary(remaining, name, ' '.repeat(name.length));
        }
    }
    
    const fallbackRegex = /[\p{Letter}\p{Number}_]+/gu;
    const fallbackMatches = remaining.match(fallbackRegex) || [];
    
    for (const match of fallbackMatches) {
        if (!match) continue;
        const firstChar = match[0];
        if (!/[\p{Letter}_]/u.test(firstChar)) continue;
        if (isReservedWord(match)) continue;
        if (isMathFunction(match)) continue;
        if (isMathConstant(match)) continue;
        if (/^[0-9]+$/.test(match)) continue;
        found.add(match);
    }
    
    return [...found];
}

export function detectDependencies(metric, allMetrics) {
    if (metric.type !== 'formula' || !metric.formula) {
        return [];
    }
    
    const variableNames = extractVariableNames(metric.formula, allMetrics);
    const metricNames = new Set(allMetrics.map(m => m.name));
    
    return variableNames.filter(name => metricNames.has(name));
}

export function detectCircularDependency(metrics) {
    const metricMap = new Map();
    metrics.forEach(m => metricMap.set(m.name, m));
    
    const visited = new Set();
    const recursionStack = new Set();
    const result = {
        hasCycle: false,
        cycles: []
    };

    function dfs(metricName, path = []) {
        if (recursionStack.has(metricName)) {
            const cycleStartIndex = path.indexOf(metricName);
            if (cycleStartIndex !== -1) {
                const cycle = path.slice(cycleStartIndex);
                cycle.push(metricName);
                result.hasCycle = true;
                result.cycles.push(cycle);
            }
            return;
        }

        if (visited.has(metricName)) {
            return;
        }

        visited.add(metricName);
        recursionStack.add(metricName);

        const metric = metricMap.get(metricName);
        if (metric) {
            const deps = detectDependencies(metric, metrics);
            for (const dep of deps) {
                dfs(dep, [...path, metricName]);
            }
        }

        recursionStack.delete(metricName);
    }

    for (const metric of metrics) {
        if (!visited.has(metric.name)) {
            dfs(metric.name);
        }
    }

    return result;
}

export function getTopologicalOrder(metrics) {
    const metricMap = new Map();
    metrics.forEach(m => metricMap.set(m.name, m));
    
    const inDegree = new Map();
    const adjacencyList = new Map();
    
    metrics.forEach(m => {
        inDegree.set(m.name, 0);
        adjacencyList.set(m.name, []);
    });

    metrics.forEach(metric => {
        const deps = detectDependencies(metric, metrics);
        deps.forEach(dep => {
            if (adjacencyList.has(dep)) {
                adjacencyList.get(dep).push(metric.name);
                inDegree.set(metric.name, (inDegree.get(metric.name) || 0) + 1);
            }
        });
    });

    const queue = [];
    metrics.forEach(m => {
        if (inDegree.get(m.name) === 0) {
            queue.push(m.name);
        }
    });

    const result = [];
    while (queue.length > 0) {
        const current = queue.shift();
        result.push(current);
        
        const neighbors = adjacencyList.get(current) || [];
        for (const neighbor of neighbors) {
            const newDegree = (inDegree.get(neighbor) || 0) - 1;
            inDegree.set(neighbor, newDegree);
            if (newDegree === 0) {
                queue.push(neighbor);
            }
        }
    }

    return result;
}

function protectMathNames(formula) {
    const protections = [];
    let result = stripMathPrefix(formula);
    let placeholderIndex = 0;
    
    const allMathNames = [...MATH_FUNCTIONS, ...MATH_CONSTANTS]
        .sort((a, b) => b.length - a.length);
    
    for (const name of allMathNames) {
        if (hasBoundaryMatch(result, name)) {
            const regex = getBoundaryRegexCaseInsensitive(name);
            let match;
            let tempResult = result;
            while ((match = regex.exec(tempResult)) !== null) {
                const matchedText = match[0];
                const placeholder = `__MATH_${placeholderIndex}__`;
                protections.push({ placeholder, original: matchedText });
                tempResult = replaceWithBoundaryCaseInsensitive(tempResult, matchedText, placeholder);
                placeholderIndex++;
                regex.lastIndex = 0;
            }
            result = tempResult;
        }
    }
    
    return { formula: result, protections };
}

function restoreMathNamesWithMathPrefix(formula, protections) {
    let result = formula;
    
    for (const { placeholder, original } of protections) {
        const lowerOriginal = original.toLowerCase();
        if (MATH_FUNCTIONS.some(f => f.toLowerCase() === lowerOriginal)) {
            const correctCase = MATH_FUNCTIONS.find(f => f.toLowerCase() === lowerOriginal);
            result = result.replace(new RegExp(escapeRegExp(placeholder), 'g'), `Math.${correctCase}`);
        } else if (MATH_CONSTANTS.some(c => c.toLowerCase() === lowerOriginal)) {
            const correctCase = MATH_CONSTANTS.find(c => c.toLowerCase() === lowerOriginal);
            result = result.replace(new RegExp(escapeRegExp(placeholder), 'g'), `Math.${correctCase}`);
        }
    }
    
    return result;
}

function processFormulaForEvaluation(formula, variables, varIndexMap, allMetrics) {
    const { formula: protectedFormula, protections } = protectMathNames(formula);
    
    let result = protectedFormula;
    
    const metricNames = allMetrics.map(m => m.name);
    const relevantMetricNames = metricNames.filter(name => Object.keys(variables).includes(name));
    const sortedNames = [...relevantMetricNames].sort((a, b) => b.length - a.length);
    
    for (const name of sortedNames) {
        if (!name) continue;
        const varName = `_v${varIndexMap[name]}`;
        let tempResult = result;
        const regex = getBoundaryRegex(name);
        let match;
        while ((match = regex.exec(tempResult)) !== null) {
            tempResult = replaceWithBoundary(tempResult, name, varName);
            regex.lastIndex = 0;
        }
        result = tempResult;
    }
    
    result = restoreMathNamesWithMathPrefix(result, protections);
    
    return result;
}

function sanitizeMathFunctions(formula) {
    let result = formula;
    
    result = result.replace(/Math\./gi, '');
    
    const { formula: protectedFormula, protections } = protectMathNames(result);
    result = restoreMathNamesWithMathPrefix(protectedFormula, protections);
    
    return result;
}

export function evaluateFormula(formula, variables, allMetrics) {
    const variableNames = extractVariableNames(formula, allMetrics);
    const metricNames = new Set(allMetrics.map(m => m.name));
    
    for (const name of variableNames) {
        if (!isMathFunction(name) && !isMathConstant(name) && !isReservedWord(name)) {
            if (!metricNames.has(name)) {
                return { success: false, error: `引用不存在的指标: ${name}` };
            }
        }
    }

    for (const name of variableNames) {
        if (metricNames.has(name)) {
            const val = variables[name];
            if (val === null || val === undefined || val === '' || isNaN(Number(val))) {
                return { success: false, error: `引用缺失: 指标 "${name}" 无有效值` };
            }
        }
    }

    const metricVariables = {};
    for (const m of allMetrics) {
        if (m.name in variables) {
            const val = variables[m.name];
            if (val !== null && val !== undefined && val !== '' && !isNaN(Number(val))) {
                metricVariables[m.name] = Number(val);
            }
        }
    }

    try {
        const varIndexMap = {};
        const varKeys = Object.keys(metricVariables);
        varKeys.forEach((key, index) => {
            varIndexMap[key] = index;
        });
        
        let processedFormula = processFormulaForEvaluation(formula, metricVariables, varIndexMap, allMetrics);
        
        const varValues = varKeys.map(k => metricVariables[k]);
        const paramNames = varKeys.map((_, i) => `_v${i}`);
        
        const fn = new Function(...paramNames, `"use strict"; return (${processedFormula});`);
        const result = fn(...varValues);
        
        if (typeof result !== 'number' || !isFinite(result)) {
            return { success: false, error: '计算结果无效' };
        }
        
        return { success: true, value: result };
    } catch (e) {
        return { success: false, error: `公式语法错误: ${e.message}` };
    }
}

export function calculateRow(rowData, metrics) {
    const circularResult = detectCircularDependency(metrics);
    const circularMetrics = new Set();
    const circularErrors = {};
    
    if (circularResult.hasCycle) {
        circularResult.cycles.forEach(cycle => {
            cycle.forEach(name => {
                circularMetrics.add(name);
                circularErrors[name] = `循环依赖: ${cycle.join(' → ')}`;
            });
        });
    }

    const order = getTopologicalOrder(metrics);
    const allMetricNames = new Set(metrics.map(m => m.name));
    for (const name of order) {
        allMetricNames.delete(name);
    }
    for (const metric of metrics) {
        if (!order.includes(metric.name)) {
            order.push(metric.name);
        }
    }

    const result = { ...rowData };
    const errors = {};

    for (const metricName of order) {
        const metric = metrics.find(m => m.name === metricName);
        if (!metric) continue;

        if (circularMetrics.has(metricName)) {
            errors[metricName] = circularErrors[metricName] || '循环依赖';
            result[metricName] = null;
            continue;
        }

        if (metric.type === 'formula' && metric.formula) {
            const allVariables = {};
            for (const m of metrics) {
                if (result[m.name] !== undefined && result[m.name] !== null && result[m.name] !== '') {
                    allVariables[m.name] = Number(result[m.name]);
                }
            }
            
            const evalResult = evaluateFormula(metric.formula, allVariables, metrics);
            if (evalResult.success) {
                result[metricName] = evalResult.value;
            } else {
                errors[metricName] = evalResult.error;
                result[metricName] = null;
            }
        }
    }

    return { values: result, errors };
}

export function validateFormulaMetrics(metrics) {
    const circularResult = detectCircularDependency(metrics);
    const errors = {};
    
    if (circularResult.hasCycle) {
        circularResult.cycles.forEach(cycle => {
            cycle.forEach(name => {
                if (!errors[name]) {
                    errors[name] = `循环依赖: ${cycle.join(' → ')}`;
                }
            });
        });
    }

    const metricNames = new Set(metrics.map(m => m.name));
    metrics.forEach(metric => {
        if (metric.type === 'formula' && metric.formula) {
            const deps = detectDependencies(metric, metrics);
            const allVarNames = extractVariableNames(metric.formula, metrics);
            
            for (const varName of allVarNames) {
                if (!isMathFunction(varName) && !isMathConstant(varName) && !isReservedWord(varName)) {
                    if (!metricNames.has(varName)) {
                        const errMsg = `引用不存在的指标: ${varName}`;
                        if (!errors[metric.name]) {
                            errors[metric.name] = [];
                        }
                        if (typeof errors[metric.name] === 'string') {
                            errors[metric.name] = [errors[metric.name]];
                        }
                        if (!errors[metric.name].includes(errMsg)) {
                            errors[metric.name].push(errMsg);
                        }
                    }
                }
            }
        }
    });

    return errors;
}

export function formatError(error) {
    if (Array.isArray(error)) {
        return error.join('; ');
    }
    return error || '';
}
