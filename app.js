import { calculateRow, validateFormulaMetrics, formatError } from './formula-engine.js';

const STORAGE_KEY = 'formula-dashboard-data';

let state = {
    metrics: [
        { id: 'm1', name: '收入', type: 'input', formula: '' },
        { id: 'm2', name: '成本', type: 'input', formula: '' },
        { id: 'm3', name: '利润', type: 'formula', formula: '收入 - 成本' }
    ],
    dataRows: [
        { id: 'r1', 收入: 1000, 成本: 600 }
    ]
};

function generateId() {
    return 'm' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateRowId() {
    return 'r' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function loadFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            state = JSON.parse(saved);
        }
    } catch (e) {
        console.error('加载数据失败:', e);
    }
}

function saveToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('保存数据失败:', e);
    }
}

function renderMetrics() {
    const container = document.getElementById('metricList');
    const errors = validateFormulaMetrics(state.metrics);
    
    container.innerHTML = state.metrics.map(metric => {
        const hasError = errors[metric.name];
        const errorMsg = formatError(errors[metric.name]);
        
        return `
            <div class="metric-card${hasError ? ' error' : ''}" data-id="${metric.id}">
                <div class="metric-header">
                    <span class="metric-name">${metric.name || '(未命名)'}</span>
                    <span class="metric-type${metric.type === 'formula' ? ' formula' : ''}">
                        ${metric.type === 'formula' ? '公式' : '输入'}
                    </span>
                </div>
                <div class="form-group">
                    <label>指标名称</label>
                    <input type="text" class="metric-name-input" value="${metric.name}" placeholder="输入指标名称">
                </div>
                <div class="form-group">
                    <label>类型</label>
                    <select class="metric-type-select">
                        <option value="input"${metric.type === 'input' ? ' selected' : ''}>输入</option>
                        <option value="formula"${metric.type === 'formula' ? ' selected' : ''}>公式</option>
                    </select>
                </div>
                ${metric.type === 'formula' ? `
                    <div class="form-group">
                        <label>计算公式</label>
                        <input type="text" class="metric-formula-input" value="${metric.formula || ''}" placeholder="例如: 收入 - 成本">
                    </div>
                ` : ''}
                ${hasError ? `<div class="error-message">⚠️ ${errorMsg}</div>` : ''}
                <div class="metric-actions">
                    <button class="btn btn-danger delete-metric-btn">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderTable() {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');
    
    const metricErrors = validateFormulaMetrics(state.metrics);
    const hasMetricErrors = Object.keys(metricErrors).length > 0;
    
    thead.innerHTML = `
        <tr>
            <th>#</th>
            ${state.metrics.map(m => {
                const hasErr = metricErrors[m.name];
                return `<th>${m.name || '(未命名)'}${m.type === 'formula' ? ' (公式)' : ''}${hasErr ? ' ⚠️' : ''}</th>`;
            }).join('')}
            <th>操作</th>
        </tr>
    `;
    
    const calculatedRows = state.dataRows.map(row => {
        const rowData = {};
        state.metrics.forEach(m => {
            rowData[m.name] = row[m.name];
        });
        return calculateRow(rowData, state.metrics);
    });
    
    tbody.innerHTML = state.dataRows.map((row, rowIndex) => {
        const calc = calculatedRows[rowIndex];
        
        return `
            <tr data-id="${row.id}">
                <td>${rowIndex + 1}</td>
                ${state.metrics.map(m => {
                    const isFormula = m.type === 'formula';
                    const hasRowError = calc.errors[m.name];
                    const metricError = metricErrors[m.name];
                    const hasError = hasRowError || metricError;
                    
                    if (isFormula || hasError) {
                        const value = calc.values[m.name];
                        const errorMsg = formatError(hasRowError || metricError);
                        return `
                            <td class="${hasError ? 'error' : 'calculated'}" title="${hasError ? errorMsg : ''}">
                                ${hasError ? '<span class="error-icon">⚠️</span>' : ''}
                                <span class="value">${hasError ? errorMsg : (value !== null && value !== undefined ? value.toFixed(2) : '-')}</span>
                            </td>
                        `;
                    } else {
                        return `
                            <td>
                                <input type="number" class="row-input" data-metric="${m.name}" value="${row[m.name] ?? ''}">
                            </td>
                        `;
                    }
                }).join('')}
                <td>
                    <button class="btn btn-danger delete-row-btn">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function bindMetricEvents() {
    const container = document.getElementById('metricList');
    
    container.addEventListener('input', (e) => {
        const card = e.target.closest('.metric-card');
        if (!card) return;
        
        const id = card.dataset.id;
        const metric = state.metrics.find(m => m.id === id);
        if (!metric) return;
        
        if (e.target.classList.contains('metric-name-input')) {
            const oldName = metric.name;
            const newName = e.target.value;
            
            state.dataRows.forEach(row => {
                if (oldName in row && oldName !== newName) {
                    row[newName] = row[oldName];
                    delete row[oldName];
                }
            });
            
            metric.name = newName;
            saveAndRender();
        } else if (e.target.classList.contains('metric-formula-input')) {
            metric.formula = e.target.value;
            saveAndRender();
        }
    });
    
    container.addEventListener('change', (e) => {
        const card = e.target.closest('.metric-card');
        if (!card) return;
        
        const id = card.dataset.id;
        const metric = state.metrics.find(m => m.id === id);
        if (!metric) return;
        
        if (e.target.classList.contains('metric-type-select')) {
            metric.type = e.target.value;
            if (metric.type === 'formula' && !metric.formula) {
                metric.formula = '';
            }
            saveAndRender();
        }
    });
    
    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-metric-btn')) {
            const card = e.target.closest('.metric-card');
            if (!card) return;
            
            const id = card.dataset.id;
            const metric = state.metrics.find(m => m.id === id);
            if (metric) {
                state.dataRows.forEach(row => {
                    delete row[metric.name];
                });
            }
            state.metrics = state.metrics.filter(m => m.id !== id);
            saveAndRender();
        }
    });
}

function bindTableEvents() {
    const tbody = document.getElementById('tableBody');
    
    tbody.addEventListener('input', (e) => {
        if (e.target.classList.contains('row-input')) {
            const tr = e.target.closest('tr');
            if (!tr) return;
            
            const rowId = tr.dataset.id;
            const metricName = e.target.dataset.metric;
            const value = e.target.value;
            
            const row = state.dataRows.find(r => r.id === rowId);
            if (row) {
                row[metricName] = value === '' ? '' : Number(value);
                saveToStorage();
                renderTable();
            }
        }
    });
    
    tbody.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-row-btn')) {
            const tr = e.target.closest('tr');
            if (!tr) return;
            
            const rowId = tr.dataset.id;
            state.dataRows = state.dataRows.filter(r => r.id !== rowId);
            saveAndRender();
        }
    });
}

function bindGlobalEvents() {
    document.getElementById('addMetricBtn').addEventListener('click', () => {
        state.metrics.push({
            id: generateId(),
            name: `指标${state.metrics.length + 1}`,
            type: 'input',
            formula: ''
        });
        saveAndRender();
    });
    
    document.getElementById('addRowBtn').addEventListener('click', () => {
        const newRow = { id: generateRowId() };
        state.metrics.forEach(m => {
            if (m.type === 'input') {
                newRow[m.name] = '';
            }
        });
        state.dataRows.push(newRow);
        saveAndRender();
    });
    
    document.getElementById('clearDataBtn').addEventListener('click', () => {
        if (confirm('确定要清空所有数据吗？此操作不可恢复。')) {
            state = {
                metrics: [],
                dataRows: []
            };
            saveAndRender();
        }
    });
}

function saveAndRender() {
    saveToStorage();
    renderMetrics();
    renderTable();
}

function init() {
    loadFromStorage();
    renderMetrics();
    renderTable();
    bindMetricEvents();
    bindTableEvents();
    bindGlobalEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
