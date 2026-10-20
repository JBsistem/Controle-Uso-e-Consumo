import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const expenseForm = document.querySelector('#expense-form');
const saveButton = document.querySelector('#save-button');
const formMessage = document.querySelector('#form-message');
const dataMessage = document.querySelector('#data-message');
const historyList = document.querySelector('#history-list');
const historyEmpty = document.querySelector('#history-empty');
const historyCount = document.querySelector('#history-count');
const reportType = document.querySelector('#report-type');
const reportMonth = document.querySelector('#report-month');
const reportYear = document.querySelector('#report-year');
const monthControl = document.querySelector('#month-control');
const yearControl = document.querySelector('#year-control');
const reportTableBody = document.querySelector('#report-table-body');
const reportEmpty = document.querySelector('#report-empty');
const reportCount = document.querySelector('#report-count');
const exportReportButton = document.querySelector('#export-report-button');
const cancelEditButton = document.querySelector('#cancel-edit-button');

const firebaseConfigured = firebaseConfig.apiKey !== 'SUA_API_KEY'
  && firebaseConfig.projectId !== 'SEU_PROJECT_ID'
  && firebaseConfig.appId !== 'SEU_APP_ID';

let auth;
let db;
let unsubscribeExpenses;
let expenses = [];
let activeUserId;
let editingExpenseId;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' });
const currentDate = new Date();
reportMonth.value = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
reportYear.value = String(currentDate.getFullYear());
document.querySelector('#entry-date').value = [
  currentDate.getFullYear(),
  String(currentDate.getMonth() + 1).padStart(2, '0'),
  String(currentDate.getDate()).padStart(2, '0')
].join('-');

function setFeedback(element, message = '', type = '') {
  element.textContent = message;
  element.classList.toggle('error', type === 'error');
  element.classList.toggle('success', type === 'success');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportReport() {
  const periodExpenses = getPeriodExpenses();
  if (periodExpenses.length === 0) {
    setFeedback(dataMessage, 'Não há registros no período selecionado para exportar.', 'error');
    return;
  }

  const periodName = reportType.value === 'month' ? reportMonth.value : reportYear.value;
  const periodLabel = reportType.value === 'month' ? 'Mensal' : 'Anual';
  const requestedTotal = periodExpenses.reduce((sum, expense) => sum + getRecordCents(expense.requester), 0);
  const proposalTotal = periodExpenses.reduce((sum, expense) => sum + getRecordCents(expense.buyer), 0);
  const rows = [
    ['Relatório', periodLabel, periodName],
    [],
    ['Data', 'Setor solicitante', 'Site solicitante', 'Link recebido', 'Produto solicitado', 'Valor solicitado',
      'Setor comprador', 'Site da proposta', 'Link da proposta', 'Produto proposto', 'Valor da proposta', 'Diferença']
  ];

  for (const expense of periodExpenses) {
    rows.push([
      formatDate(expense.date),
      expense.requester?.sector,
      expense.requester?.site,
      expense.requester?.link,
      expense.requester?.product,
      formatCents(getRecordCents(expense.requester)),
      expense.buyer?.sector,
      expense.buyer?.site,
      expense.buyer?.link,
      expense.buyer?.product,
      formatCents(getRecordCents(expense.buyer)),
      formatCents(getRecordCents(expense.requester) - getRecordCents(expense.buyer))
    ]);
  }
  const products = new Map();
  for (const expense of periodExpenses) {
    const product = String(expense.requester?.product || expense.buyer?.product || 'Produto sem nome').trim();
    const key = product.toLocaleLowerCase('pt-BR');
    const totals = products.get(key) || { product, requested: 0, proposal: 0 };
    totals.requested += getRecordCents(expense.requester);
    totals.proposal += getRecordCents(expense.buyer);
    products.set(key, totals);
  }
  rows.push(
    [],
    ['Comparativo por produto'],
    ['Produto', 'Solicitado', 'Proposta', 'Diferença'],
    ...[...products.values()]
      .sort((left, right) => left.product.localeCompare(right.product, 'pt-BR'))
      .map((totals) => [
        totals.product,
        formatCents(totals.requested),
        formatCents(totals.proposal),
        formatCents(totals.requested - totals.proposal)
      ]),
    [],
    ['Totais do período', '', '', '', '', formatCents(requestedTotal), '', '', '', '', formatCents(proposalTotal),
      formatCents(requestedTotal - proposalTotal)]
  );

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-${reportType.value === 'month' ? 'mensal' : 'anual'}-${periodName}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setFeedback(dataMessage, `Relatório ${periodLabel.toLowerCase()} exportado.`, 'success');
}

function getFriendlyError(error) {
  const messages = {
    'auth/operation-not-allowed': 'Habilite o provedor Anônimo em Authentication > Sign-in method no Firebase.',
    'auth/admin-restricted-operation': 'O Firebase bloqueou o acesso anônimo. Habilite o provedor Anônimo em Authentication > Sign-in method.',
    'permission-denied': 'Acesso negado. Confira as regras do Firestore.',
    'unavailable': 'Firebase indisponível no momento. Verifique sua conexão.'
  };
  return messages[error.code] || `Não foi possível concluir a operação: ${error.message}`;
}

function getExpensesCollection(userId) {
  return collection(db, 'users', userId, 'expenses');
}

function isAllowedLink(value) {
  if (!value) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Data inválida' : dateFormatter.format(date);
}

function parseMoneyCents(value) {
  let normalized = value.trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (normalized.includes(',')) {
    normalized = normalized.includes('.')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(',', '.');
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function getRecordCents(record = {}) {
  if (Number.isSafeInteger(record.valueCents)) return record.valueCents;
  return Math.round(Number(record.value || 0) * 100);
}

function formatCents(cents) {
  return currency.format(cents / 100);
}

function formatInputCents(cents) {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getPeriodExpenses() {
  if (reportType.value === 'month') {
    const prefix = reportMonth.value;
    return prefix ? expenses.filter((expense) => expense.date?.startsWith(`${prefix}-`)) : [];
  }
  const year = reportYear.value;
  return year ? expenses.filter((expense) => expense.date?.startsWith(`${year}-`)) : [];
}

function renderReport() {
  const periodExpenses = getPeriodExpenses();
  const requestedTotal = periodExpenses.reduce((sum, expense) => sum + getRecordCents(expense.requester), 0);
  const proposalTotal = periodExpenses.reduce((sum, expense) => sum + getRecordCents(expense.buyer), 0);
  const difference = requestedTotal - proposalTotal;

  document.querySelector('#requested-total').textContent = formatCents(requestedTotal);
  document.querySelector('#proposal-total').textContent = formatCents(proposalTotal);
  document.querySelector('#difference-total').textContent = formatCents(difference);
  document.querySelector('#difference-caption').textContent = difference >= 0
    ? 'Economia em relação ao solicitado'
    : 'Proposta acima do valor solicitado';
  document.querySelector('.savings-card').classList.toggle('negative', difference < 0);
  reportCount.textContent = `${periodExpenses.length} ${periodExpenses.length === 1 ? 'registro' : 'registros'}`;

  const byProduct = new Map();
  for (const expense of periodExpenses) {
    const product = String(expense.requester?.product || expense.buyer?.product || 'Produto sem nome').trim();
    const key = product.toLocaleLowerCase('pt-BR');
    const row = byProduct.get(key) || { product, requested: 0, proposal: 0 };
    row.requested += getRecordCents(expense.requester);
    row.proposal += getRecordCents(expense.buyer);
    byProduct.set(key, row);
  }

  reportTableBody.replaceChildren();
  for (const row of [...byProduct.values()].sort((a, b) => a.product.localeCompare(b.product, 'pt-BR'))) {
    const tableRow = document.createElement('tr');
    const values = [
      row.product,
      formatCents(row.requested),
      formatCents(row.proposal),
      formatCents(row.requested - row.proposal)
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 3) {
        cell.classList.add(row.requested - row.proposal < 0 ? 'negative-value' : 'positive-value');
      }
      tableRow.append(cell);
    });
    reportTableBody.append(tableRow);
  }
  reportEmpty.classList.toggle('hidden', periodExpenses.length > 0);
}

function createHistoryProduct(label, record = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'history-product';
  const title = document.createElement('strong');
  title.textContent = record.product || 'Produto sem nome';
  const detail = document.createElement('small');
  detail.textContent = `${label} · ${formatCents(getRecordCents(record))}`;
  wrapper.append(title, detail);

  if (record.site) {
    const site = document.createElement('small');
    site.textContent = `Site / unidade: ${record.site}`;
    wrapper.append(site);
  }
  if (record.link && isAllowedLink(record.link)) {
    const link = document.createElement('a');
    link.className = 'history-link';
    link.href = record.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir link';
    wrapper.append(link);
  }
  return wrapper;
}

function renderHistory() {
  historyList.replaceChildren();
  historyCount.textContent = `${expenses.length} ${expenses.length === 1 ? 'registro' : 'registros'}`;
  historyEmpty.classList.toggle('hidden', expenses.length > 0);

  for (const expense of expenses) {
    const card = document.createElement('article');
    card.className = 'history-card';

    const date = document.createElement('span');
    date.className = 'history-date';
    date.textContent = formatDate(expense.date);

    const requester = createHistoryProduct(
      `Solicitado · ${expense.requester?.sector || 'Setor não informado'}`,
      expense.requester
    );
    const buyer = createHistoryProduct(
      `Proposta · ${expense.buyer?.sector || 'Setor não informado'}`,
      expense.buyer
    );

    const removeButton = document.createElement('button');
    const editButton = document.createElement('button');
    editButton.className = 'edit-button';
    editButton.type = 'button';
    editButton.textContent = 'Editar';
    editButton.setAttribute('aria-label', `Editar registro de ${expense.requester?.product || 'produto'}`);
    editButton.addEventListener('click', () => editExpense(expense));

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.append(editButton);

    removeButton.className = 'delete-button';
    removeButton.type = 'button';
    removeButton.textContent = 'Excluir';
    removeButton.setAttribute('aria-label', `Excluir registro de ${expense.requester?.product || 'produto'}`);
    removeButton.addEventListener('click', () => removeExpense(expense.id, removeButton));
    actions.append(removeButton);

    card.append(date, requester, buyer, actions);
    historyList.append(card);
  }
}

function resetExpenseForm() {
  expenseForm.reset();
  editingExpenseId = undefined;
  document.querySelector('#entry-date').value = [
    currentDate.getFullYear(),
    String(currentDate.getMonth() + 1).padStart(2, '0'),
    String(currentDate.getDate()).padStart(2, '0')
  ].join('-');
  saveButton.innerHTML = 'Salvar comparativo <span aria-hidden="true">→</span>';
  cancelEditButton.classList.add('hidden');
  setFeedback(formMessage);
}

function editExpense(expense) {
  editingExpenseId = expense.id;
  const values = {
    date: expense.date,
    requesterSector: expense.requester?.sector,
    requesterSite: expense.requester?.site,
    requesterLink: expense.requester?.link,
    requesterProduct: expense.requester?.product,
    requesterValue: formatInputCents(getRecordCents(expense.requester)),
    buyerSector: expense.buyer?.sector,
    buyerSite: expense.buyer?.site,
    buyerLink: expense.buyer?.link,
    buyerProduct: expense.buyer?.product,
    buyerValue: formatInputCents(getRecordCents(expense.buyer))
  };
  for (const [name, value] of Object.entries(values)) {
    expenseForm.elements.namedItem(name).value = value || '';
  }
  saveButton.innerHTML = 'Atualizar comparativo <span aria-hidden="true">→</span>';
  cancelEditButton.classList.remove('hidden');
  setFeedback(formMessage, 'Editando comparativo. Salve para aplicar as alterações.');

  document.querySelectorAll('.tab-button').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === 'registro');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
  document.querySelector('#registro-panel').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function watchExpenses(userId) {
  if (unsubscribeExpenses) unsubscribeExpenses();
  activeUserId = userId;
  setFeedback(dataMessage, 'Carregando seus registros...');
  const expensesQuery = query(getExpensesCollection(userId), orderBy('date', 'desc'));
  unsubscribeExpenses = onSnapshot(expensesQuery, (snapshot) => {
    expenses = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderHistory();
    renderReport();
    setFeedback(dataMessage);
  }, (error) => {
    setFeedback(dataMessage, getFriendlyError(error), 'error');
  });
}

async function removeExpense(expenseId, button) {
  if (!activeUserId || !window.confirm('Deseja excluir este comparativo? Esta ação não pode ser desfeita.')) return;
  button.disabled = true;
  setFeedback(dataMessage);
  try {
    await deleteDoc(doc(db, 'users', activeUserId, 'expenses', expenseId));
    setFeedback(dataMessage, 'Registro excluído.', 'success');
  } catch (error) {
    button.disabled = false;
    setFeedback(dataMessage, getFriendlyError(error), 'error');
  }
}

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
    document.querySelector(`#${button.dataset.tab}-panel`).classList.remove('hidden');
  });
});

expenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeUserId) {
    setFeedback(formMessage, 'A conexão ainda está sendo preparada. Aguarde e tente novamente.', 'error');
    return;
  }

  const fields = new FormData(expenseForm);
  const requesterValueCents = parseMoneyCents(String(fields.get('requesterValue')));
  const buyerValueCents = parseMoneyCents(String(fields.get('buyerValue')));
  if (!isAllowedLink(String(fields.get('requesterLink')).trim())
    || !isAllowedLink(String(fields.get('buyerLink')).trim())) {
    setFeedback(formMessage, 'Os links devem usar os endereços http:// ou https://.', 'error');
    return;
  }
  if (requesterValueCents === null || buyerValueCents === null) {
    setFeedback(formMessage, 'Informe os valores com até duas casas decimais. Exemplo: 123,45.', 'error');
    return;
  }

  const entry = {
    date: fields.get('date'),
    requester: {
      sector: String(fields.get('requesterSector')).trim(),
      site: String(fields.get('requesterSite')).trim(),
      link: String(fields.get('requesterLink')).trim(),
      product: String(fields.get('requesterProduct')).trim(),
      valueCents: requesterValueCents
    },
    buyer: {
      sector: String(fields.get('buyerSector')).trim(),
      site: String(fields.get('buyerSite')).trim(),
      link: String(fields.get('buyerLink')).trim(),
      product: String(fields.get('buyerProduct')).trim(),
      valueCents: buyerValueCents
    },
    createdAt: serverTimestamp()
  };

  saveButton.disabled = true;
  setFeedback(formMessage, editingExpenseId ? 'Atualizando comparativo...' : 'Salvando comparativo...');
  try {
    if (editingExpenseId) {
      await updateDoc(doc(db, 'users', activeUserId, 'expenses', editingExpenseId), entry);
      resetExpenseForm();
      setFeedback(formMessage, 'Comparativo atualizado com sucesso.', 'success');
    } else {
      await addDoc(getExpensesCollection(activeUserId), entry);
      resetExpenseForm();
      setFeedback(formMessage, 'Comparativo salvo com sucesso.', 'success');
    }
  } catch (error) {
    setFeedback(formMessage, getFriendlyError(error), 'error');
  } finally {
    saveButton.disabled = false;
  }
});

cancelEditButton.addEventListener('click', resetExpenseForm);

document.querySelectorAll('input[name="requesterValue"], input[name="buyerValue"]').forEach((input) => {
  input.addEventListener('blur', () => {
    const cents = parseMoneyCents(input.value);
    if (cents !== null) input.value = formatInputCents(cents);
  });
});

reportType.addEventListener('change', () => {
  const isMonthly = reportType.value === 'month';
  monthControl.classList.toggle('hidden', !isMonthly);
  yearControl.classList.toggle('hidden', isMonthly);
  renderReport();
});

reportMonth.addEventListener('input', renderReport);
reportYear.addEventListener('input', renderReport);
exportReportButton.addEventListener('click', exportReport);

if (!firebaseConfigured) {
  setFeedback(dataMessage, 'Configure as credenciais do Firebase no arquivo firebase-config.js para salvar os registros. Consulte o README.');
}

if (firebaseConfigured) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    onAuthStateChanged(auth, (user) => {
      if (user) {
        watchExpenses(user.uid);
      } else {
        setFeedback(dataMessage, 'Preparando acesso seguro...');
        signInAnonymously(auth).catch((error) => {
          setFeedback(dataMessage, getFriendlyError(error), 'error');
        });
      }
    }, (error) => {
      setFeedback(dataMessage, getFriendlyError(error), 'error');
    });
  } catch (error) {
    setFeedback(dataMessage, `Erro ao iniciar o Firebase: ${error.message}`, 'error');
  }
}
