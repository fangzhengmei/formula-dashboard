import { describe, it, expect } from 'vitest';
import {
    extractVariableNames,
    detectDependencies,
    detectCircularDependency,
    getTopologicalOrder,
    sanitizeFormula,
    evaluateFormula,
    calculateRow,
    validateFormulaMetrics
} from './formula-engine.js';

describe('extractVariableNames', () => {
    it('提取公式中的变量名', () => {
        expect(extractVariableNames('a + b')).toEqual(['a', 'b']);
        expect(extractVariableNames('收入 - 成本')).toEqual(['收入', '成本']);
    });

    it('去重变量名', () => {
        expect(extractVariableNames('a + a * b')).toEqual(['a', 'b']);
    });

    it('过滤保留字', () => {
        expect(extractVariableNames('a + true')).toEqual(['a']);
        expect(extractVariableNames('false || null')).toEqual([]);
    });
});

describe('detectDependencies', () => {
    const metrics = [
        { name: '收入', type: 'input' },
        { name: '成本', type: 'input' },
        { name: '利润', type: 'formula', formula: '收入 - 成本' }
    ];

    it('检测公式指标的依赖', () => {
        const profit = metrics.find(m => m.name === '利润');
        expect(detectDependencies(profit, metrics)).toEqual(['收入', '成本']);
    });

    it('输入指标无依赖', () => {
        const income = metrics.find(m => m.name === '收入');
        expect(detectDependencies(income, metrics)).toEqual([]);
    });

    it('忽略不存在的指标引用', () => {
        const metric = { name: '测试', type: 'formula', formula: '不存在的指标 + 收入' };
        expect(detectDependencies(metric, metrics)).toEqual(['收入']);
    });
});

describe('detectCircularDependency', () => {
    it('检测自引用循环', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'a + 1' }
        ];
        const result = detectCircularDependency(metrics);
        expect(result.hasCycle).toBe(true);
    });

    it('检测双向循环', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b + 1' },
            { name: 'b', type: 'formula', formula: 'a + 1' }
        ];
        const result = detectCircularDependency(metrics);
        expect(result.hasCycle).toBe(true);
    });

    it('检测无循环的情况', () => {
        const metrics = [
            { name: '收入', type: 'input' },
            { name: '成本', type: 'input' },
            { name: '利润', type: 'formula', formula: '收入 - 成本' }
        ];
        const result = detectCircularDependency(metrics);
        expect(result.hasCycle).toBe(false);
    });

    it('检测复杂循环', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b' },
            { name: 'b', type: 'formula', formula: 'c' },
            { name: 'c', type: 'formula', formula: 'a' }
        ];
        const result = detectCircularDependency(metrics);
        expect(result.hasCycle).toBe(true);
    });
});

describe('getTopologicalOrder', () => {
    it('对无依赖指标排序', () => {
        const metrics = [
            { name: 'c', type: 'formula', formula: 'a + b' },
            { name: 'a', type: 'input' },
            { name: 'b', type: 'input' }
        ];
        const order = getTopologicalOrder(metrics);
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('链式依赖排序', () => {
        const metrics = [
            { name: 'c', type: 'formula', formula: 'b' },
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a' }
        ];
        const order = getTopologicalOrder(metrics);
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });
});

describe('sanitizeFormula', () => {
    it('转换数学函数', () => {
        expect(sanitizeFormula('sqrt(4)')).toContain('Math.sqrt');
        expect(sanitizeFormula('abs(-5)')).toContain('Math.abs');
        expect(sanitizeFormula('pow(2, 3)')).toContain('Math.pow');
    });

    it('转换数学常量', () => {
        expect(sanitizeFormula('PI')).toBe('Math.PI');
        expect(sanitizeFormula('E')).toBe('Math.E');
    });

    it('处理重复的 Math. 前缀', () => {
        expect(sanitizeFormula('Math.sqrt(4)')).toContain('Math.sqrt');
    });
});

describe('evaluateFormula', () => {
    const metrics = [
        { name: 'a', type: 'input' },
        { name: 'b', type: 'input' }
    ];

    it('正确计算简单公式', () => {
        const result = evaluateFormula('a + b', { a: 2, b: 3 }, metrics);
        expect(result.success).toBe(true);
        expect(result.value).toBe(5);
    });

    it('正确计算复杂公式', () => {
        const result = evaluateFormula('(a + b) * 2 - 1', { a: 2, b: 3 }, metrics);
        expect(result.success).toBe(true);
        expect(result.value).toBe(9);
    });

    it('检测引用缺失的变量', () => {
        const result = evaluateFormula('a + b + c', { a: 1 }, metrics);
        expect(result.success).toBe(false);
        expect(result.error).toContain('引用缺失');
    });

    it('检测无效数值', () => {
        const result = evaluateFormula('a + b', { a: 1, b: '' }, metrics);
        expect(result.success).toBe(false);
    });

    it('检测语法错误', () => {
        const result = evaluateFormula('a + + b', { a: 1, b: 2 }, metrics);
        expect(result.success).toBe(false);
    });

    it('使用数学函数', () => {
        const result = evaluateFormula('sqrt(a)', { a: 16 }, metrics);
        expect(result.success).toBe(true);
        expect(result.value).toBe(4);
    });
});

describe('calculateRow', () => {
    it('计算基本公式', () => {
        const metrics = [
            { name: '收入', type: 'input' },
            { name: '成本', type: 'input' },
            { name: '利润', type: 'formula', formula: '收入 - 成本' }
        ];
        const rowData = { 收入: 1000, 成本: 600 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.values['利润']).toBe(400);
        expect(result.errors['利润']).toBeUndefined();
    });

    it('链式公式计算', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a * 2' },
            { name: 'c', type: 'formula', formula: 'b + 1' }
        ];
        const rowData = { a: 5 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.values['b']).toBe(10);
        expect(result.values['c']).toBe(11);
    });

    it('循环依赖返回错误', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b + 1' },
            { name: 'b', type: 'formula', formula: 'a + 1' }
        ];
        const rowData = {};
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['a']).toBe('循环依赖');
        expect(result.errors['b']).toBe('循环依赖');
    });

    it('引用缺失返回错误', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a + c' }
        ];
        const rowData = { a: 1 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['b']).toBeDefined();
        expect(result.errors['b']).toContain('引用不存在');
    });

    it('输入值为字符串数字时正确转换', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a * 2' }
        ];
        const rowData = { a: '10' };
        const result = calculateRow(rowData, metrics);
        
        expect(result.values['b']).toBe(20);
    });
});

describe('validateFormulaMetrics', () => {
    it('检测循环依赖', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b' },
            { name: 'b', type: 'formula', formula: 'a' }
        ];
        const errors = validateFormulaMetrics(metrics);
        expect(errors['a']).toBeDefined();
        expect(errors['b']).toBeDefined();
        expect(errors['a']).toContain('循环依赖');
    });

    it('检测引用不存在的指标', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a + 不存在' }
        ];
        const errors = validateFormulaMetrics(metrics);
        expect(errors['b']).toBeDefined();
        const errMsgs = Array.isArray(errors['b']) ? errors['b'].join('') : errors['b'];
        expect(errMsgs).toContain('引用不存在');
    });

    it('无错误时返回空对象', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a * 2' }
        ];
        const errors = validateFormulaMetrics(metrics);
        expect(Object.keys(errors).length).toBe(0);
    });

    it('同时检测循环依赖和引用缺失', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b' },
            { name: 'b', type: 'formula', formula: 'a + c' }
        ];
        const errors = validateFormulaMetrics(metrics);
        expect(errors['a']).toBeDefined();
        expect(errors['b']).toBeDefined();
    });
});

describe('综合测试', () => {
    it('完整示例：收入-成本-利润-利润率', () => {
        const metrics = [
            { name: '收入', type: 'input' },
            { name: '成本', type: 'input' },
            { name: '利润', type: 'formula', formula: '收入 - 成本' },
            { name: '利润率', type: 'formula', formula: '利润 / 收入 * 100' }
        ];
        const rowData = { 收入: 1000, 成本: 600 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.values['利润']).toBe(400);
        expect(result.values['利润率']).toBeCloseTo(40);
        expect(Object.keys(result.errors).length).toBe(0);
    });

    it('多数据行独立计算', () => {
        const metrics = [
            { name: '销量', type: 'input' },
            { name: '单价', type: 'input' },
            { name: '销售额', type: 'formula', formula: '销量 * 单价' }
        ];
        
        const row1 = calculateRow({ 销量: 10, 单价: 5 }, metrics);
        const row2 = calculateRow({ 销量: 20, 单价: 8 }, metrics);
        
        expect(row1.values['销售额']).toBe(50);
        expect(row2.values['销售额']).toBe(160);
    });
});
