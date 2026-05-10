import { describe, it, expect } from 'vitest';
import {
    extractVariableNames,
    detectDependencies,
    detectCircularDependency,
    getTopologicalOrder,
    evaluateFormula,
    calculateRow,
    validateFormulaMetrics,
    formatError
} from './formula-engine.js';

describe('extractVariableNames', () => {
    it('提取公式中的英文变量名', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'input' }
        ];
        expect(extractVariableNames('a + b', metrics)).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('提取公式中的中文变量名', () => {
        const metrics = [
            { name: '收入', type: 'input' },
            { name: '成本', type: 'input' }
        ];
        expect(extractVariableNames('收入 - 成本', metrics)).toEqual(expect.arrayContaining(['收入', '成本']));
    });

    it('正确提取包含中文的复杂公式', () => {
        const metrics = [
            { name: '销售收入', type: 'input' },
            { name: '销售成本', type: 'input' },
            { name: '运营费用', type: 'input' }
        ];
        const vars = extractVariableNames('(销售收入 - 销售成本) * 0.8 - 运营费用', metrics);
        expect(vars).toEqual(expect.arrayContaining(['销售收入', '销售成本', '运营费用']));
    });

    it('处理名称前缀重叠的情况', () => {
        const metrics = [
            { name: '收入', type: 'input' },
            { name: '总收入', type: 'input' }
        ];
        const vars = extractVariableNames('总收入 + 收入', metrics);
        expect(vars).toEqual(expect.arrayContaining(['收入', '总收入']));
    });

    it('去重变量名', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'input' }
        ];
        const vars = extractVariableNames('a + a * b', metrics);
        expect(vars).toEqual(expect.arrayContaining(['a', 'b']));
        expect(vars.length).toBe(2);
    });

    it('过滤保留字', () => {
        const metrics = [{ name: 'a', type: 'input' }];
        expect(extractVariableNames('a + true', metrics)).toEqual(expect.arrayContaining(['a']));
        expect(extractVariableNames('false || null', [])).toEqual([]);
    });

    it('不将数学函数识别为变量', () => {
        const metrics = [{ name: 'a', type: 'input' }];
        const vars = extractVariableNames('sqrt(a) + abs(-5)', metrics);
        expect(vars).toEqual(['a']);
    });

    it('不将数学常量识别为变量', () => {
        const metrics = [{ name: 'r', type: 'input' }];
        const vars = extractVariableNames('2 * PI * r', metrics);
        expect(vars).toEqual(['r']);
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
        const deps = detectDependencies(profit, metrics);
        expect(deps).toEqual(expect.arrayContaining(['收入', '成本']));
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

    it('检测中文指标名的双向循环', () => {
        const metrics = [
            { name: '甲', type: 'formula', formula: '乙 + 1' },
            { name: '乙', type: 'formula', formula: '甲 + 1' }
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

    it('包含所有指标（包括循环依赖的）', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b' },
            { name: 'b', type: 'formula', formula: 'a' },
            { name: 'c', type: 'input' }
        ];
        const order = getTopologicalOrder(metrics);
        expect(order).toContain('c');
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

    it('正确计算中文变量名的公式', () => {
        const cnMetrics = [
            { name: '收入', type: 'input' },
            { name: '成本', type: 'input' }
        ];
        const result = evaluateFormula('收入 - 成本', { 收入: 1000, 成本: 600 }, cnMetrics);
        expect(result.success).toBe(true);
        expect(result.value).toBe(400);
    });

    it('正确计算复杂公式', () => {
        const result = evaluateFormula('(a + b) * 2 - 1', { a: 2, b: 3 }, metrics);
        expect(result.success).toBe(true);
        expect(result.value).toBe(9);
    });

    it('引用不存在的指标返回明确的错误', () => {
        const result = evaluateFormula('a + 不存在', { a: 1 }, metrics);
        expect(result.success).toBe(false);
        expect(result.error).toBe('引用不存在的指标: 不存在');
    });

    it('引用不存在的中文指标返回明确的错误', () => {
        const cnMetrics = [{ name: '收入', type: 'input' }];
        const result = evaluateFormula('收入 - 成本', { 收入: 1000 }, cnMetrics);
        expect(result.success).toBe(false);
        expect(result.error).toBe('引用不存在的指标: 成本');
    });

    it('检测引用缺失的变量值', () => {
        const result = evaluateFormula('a + b', { a: 1 }, metrics);
        expect(result.success).toBe(false);
        expect(result.error).toContain('引用缺失');
    });

    it('检测无效数值', () => {
        const result = evaluateFormula('a + b', { a: 1, b: '' }, metrics);
        expect(result.success).toBe(false);
    });

    it('检测语法错误', () => {
        const result = evaluateFormula('a + b )', { a: 1, b: 2 }, metrics);
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

    it('循环依赖返回循环依赖错误信息', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b + 1' },
            { name: 'b', type: 'formula', formula: 'a + 1' }
        ];
        const rowData = {};
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['a']).toBeDefined();
        expect(result.errors['a']).toContain('循环依赖');
        expect(result.errors['b']).toBeDefined();
        expect(result.errors['b']).toContain('循环依赖');
    });

    it('中文指标名的循环依赖返回详细错误信息', () => {
        const metrics = [
            { name: '甲', type: 'formula', formula: '乙 + 1' },
            { name: '乙', type: 'formula', formula: '甲 + 1' }
        ];
        const rowData = {};
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['甲']).toBeDefined();
        expect(result.errors['甲']).toContain('甲 → 乙 → 甲');
        expect(result.errors['乙']).toBeDefined();
        expect(result.errors['乙']).toContain('甲 → 乙 → 甲');
    });

    it('引用不存在的指标返回明确的错误', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'a + 不存在' }
        ];
        const rowData = { a: 1 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['b']).toBeDefined();
        expect(result.errors['b']).toBe('引用不存在的指标: 不存在');
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

    it('循环依赖的指标被包含在结果中', () => {
        const metrics = [
            { name: 'a', type: 'formula', formula: 'b' },
            { name: 'b', type: 'formula', formula: 'a' },
            { name: 'c', type: 'input' }
        ];
        const rowData = { c: 5 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['a']).toBeDefined();
        expect(result.errors['b']).toBeDefined();
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

describe('formatError', () => {
    it('字符串错误原样返回', () => {
        expect(formatError('循环依赖')).toBe('循环依赖');
    });

    it('数组错误用分号连接', () => {
        expect(formatError(['循环依赖: a → b → a', '引用不存在的指标: c']))
            .toBe('循环依赖: a → b → a; 引用不存在的指标: c');
    });

    it('undefined 返回空字符串', () => {
        expect(formatError(undefined)).toBe('');
    });

    it('null 返回空字符串', () => {
        expect(formatError(null)).toBe('');
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

    it('中文指标名完整工作流', () => {
        const metrics = [
            { name: '产品销量', type: 'input' },
            { name: '产品单价', type: 'input' },
            { name: '销售成本', type: 'input' },
            { name: '销售收入', type: 'formula', formula: '产品销量 * 产品单价' },
            { name: '销售利润', type: 'formula', formula: '销售收入 - 销售成本' }
        ];
        
        const rowData = { 产品销量: 100, 产品单价: 50, 销售成本: 3000 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.values['销售收入']).toBe(5000);
        expect(result.values['销售利润']).toBe(2000);
        expect(Object.keys(result.errors).length).toBe(0);
    });

    it('复杂场景：循环依赖 + 正常指标共存', () => {
        const metrics = [
            { name: '基础值', type: 'input' },
            { name: '甲', type: 'formula', formula: '乙 + 1' },
            { name: '乙', type: 'formula', formula: '甲 + 1' },
            { name: '正常指标', type: 'formula', formula: '基础值 * 2' }
        ];
        
        const rowData = { 基础值: 10 };
        const result = calculateRow(rowData, metrics);
        
        expect(result.errors['甲']).toBeDefined();
        expect(result.errors['乙']).toBeDefined();
        expect(result.values['正常指标']).toBe(20);
    });
});

describe('数学函数与单字母指标名回归测试', () => {
    it('单字母指标名 a + sqrt 函数', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'sqrt(a)' }
        ];
        const result = calculateRow({ a: 16 }, metrics);
        expect(result.values['b']).toBe(4);
        expect(result.errors['b']).toBeUndefined();
    });

    it('单字母指标名 a + abs 函数', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'abs(a)' }
        ];
        const result = calculateRow({ a: -5 }, metrics);
        expect(result.values['b']).toBe(5);
    });

    it('单字母指标名 a + max 函数', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'x', type: 'input' },
            { name: 'b', type: 'formula', formula: 'max(a, x)' }
        ];
        const result = calculateRow({ a: 10, x: 5 }, metrics);
        expect(result.values['b']).toBe(10);
    });

    it('单字母指标名 n + sin/tan 函数', () => {
        const metrics = [
            { name: 'n', type: 'input' },
            { name: 't', type: 'input' },
            { name: 'result', type: 'formula', formula: 'sin(n) + tan(t)' }
        ];
        const result = evaluateFormula('sin(n) + tan(t)', { n: 0, t: 0 }, metrics);
        expect(result.success).toBe(true);
        expect(result.value).toBeCloseTo(0);
    });

    it('单字母指标名与多个数学函数组合', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'input' },
            { name: 'c', type: 'formula', formula: 'sqrt(abs(a)) + max(a, b) * min(a, b)' }
        ];
        const result = calculateRow({ a: 16, b: 9 }, metrics);
        expect(result.values['c']).toBe(4 + 16 * 9);
    });

    it('单字母指标名 + pow 函数', () => {
        const metrics = [
            { name: 'o', type: 'input' },
            { name: 'w', type: 'input' },
            { name: 'result', type: 'formula', formula: 'pow(o, w)' }
        ];
        const result = calculateRow({ o: 2, w: 3 }, metrics);
        expect(result.values['result']).toBe(8);
    });

    it('单字母指标名 + round/floor/ceil 函数', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: 'round(a)' },
            { name: 'c', type: 'formula', formula: 'floor(a)' },
            { name: 'd', type: 'formula', formula: 'ceil(a)' }
        ];
        const result = calculateRow({ a: 3.7 }, metrics);
        expect(result.values['b']).toBe(4);
        expect(result.values['c']).toBe(3);
        expect(result.values['d']).toBe(4);
    });

    it('单字母指标名 + 数学常量 PI 和 E', () => {
        const metrics = [
            { name: 'r', type: 'input' },
            { name: 'circumference', type: 'formula', formula: '2 * PI * r' },
            { name: 'exponential', type: 'formula', formula: 'pow(E, r)' }
        ];
        const result = calculateRow({ r: 1 }, metrics);
        expect(result.values['circumference']).toBeCloseTo(2 * Math.PI);
        expect(result.values['exponential']).toBeCloseTo(Math.E);
    });

    it('单字母指标名 a + 复杂公式：(a + abs(a)) / 2', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'formula', formula: '(a + abs(a)) / 2' }
        ];
        const result1 = calculateRow({ a: -10 }, metrics);
        const result2 = calculateRow({ a: 10 }, metrics);
        expect(result1.values['b']).toBe(0);
        expect(result2.values['b']).toBe(10);
    });

    it('多单字母指标 + 多数学函数：sqrt(a) * b) + sin(x) * cos(y)', () => {
        const metrics = [
            { name: 'a', type: 'input' },
            { name: 'b', type: 'input' },
            { name: 'x', type: 'input' },
            { name: 'y', type: 'input' },
            { name: 'result', type: 'formula', formula: 'sqrt(a * b) + sin(x) * cos(y)' }
        ];
        const result = evaluateFormula(
            'sqrt(a * b) + sin(x) * cos(y)',
            { a: 4, b: 9, x: 0, y: 0 },
            metrics
        );
        expect(result.success).toBe(true);
        expect(result.value).toBeCloseTo(6);
    });
});
