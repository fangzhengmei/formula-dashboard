export function extractVariableNames(formula) {
    const regex = /[A-Za-z_][A-Za-z0-9_]*/g;
    const matches = formula.match(regex) || [];
    const reserved = ['true', 'false', 'null', 'undefined'];
    return [...new Set(matches.filter(name => !reserved.includes(name.toLowerCase())))];
}

export function detectDependencies(metric, allMetrics) {
    if (metric.type !== 'formula' || !metric.formula) {
        return [];
    }
    
    const variableNames = extractVariableNames(metric.formula);
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

export function sanitizeFormula(formula) {
    let result = formula;
    result = result.replace(/Math\./gi, '');
    result = result.replace(/\b(abs|acos|asin|atan|ceil|cos|exp|floor|log|max|min|pow|round|sin|sqrt|tan)\b/gi, 'Math.$1');
    result = result.replace(/\bPI\b/gi, 'Math.PI');
    result = result.replace(/\bE\b/gi, 'Math.E');
    return result;
}

export function evaluateFormula(formula, variables, allMetrics) {
    const variableNames = extractVariableNames(formula);
    const metricNames = new Set(allMetrics.map(m => m.name));
    
    for (const name of variableNames) {
        if (metricNames.has(name) && !(name in variables)) {
            return { success: false, error: `引用缺失: 指标 "${name}" 未赋值` };
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

    try {
        const sanitized = sanitizeFormula(formula);
        const varKeys = Object.keys(variables);
        const varValues = varKeys.map(k => variables[k]);
        const fn = new Function(...varKeys, `"use strict"; return (${sanitized});`);
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
    
    if (circularResult.hasCycle) {
        circularResult.cycles.forEach(cycle => {
            cycle.forEach(name => circularMetrics.add(name));
        });
    }

    const order = getTopologicalOrder(metrics);
    const result = { ...rowData };
    const errors = {};

    for (const metricName of order) {
        const metric = metrics.find(m => m.name === metricName);
        if (!metric) continue;

        if (circularMetrics.has(metricName)) {
            errors[metricName] = '循环依赖';
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
            const allVarNames = extractVariableNames(metric.formula);
            
            for (const varName of allVarNames) {
                if (!metricNames.has(varName)) {
                    if (!errors[metric.name]) {
                        errors[metric.name] = [];
                    }
                    if (!errors[metric.name].includes(`引用不存在的指标: ${varName}`)) {
                        if (typeof errors[metric.name] === 'string') {
                            errors[metric.name] = [errors[metric.name]];
                        }
                        errors[metric.name].push(`引用不存在的指标: ${varName}`);
                    }
                }
            }
        }
    });

    return errors;
}
