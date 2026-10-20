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
  serverTimestamp
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

const firebaseConfigured = firebaseConfig.apiKey !== 'SUA_API_KEY'
  && firebaseConfig.projectId !== 'SEU_PROJECT_ID'
  && firebaseConfig.appId !== 'SEU_APP_ID';

let auth;
let db;
let unsubscribeExpenses;
let expenses = [];
let activeUserId;

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

function getFriendlyError(error) {
  const messages = {
    'auth/operation-not-allowed': 'Habilite o provedor Anônimo em Authentication > Sign-in method no Firebase.',
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
  const requestedTotal = periodExpenses.reduce((sum, expense) => sum + Number(expense.requester?.value || 0), 0);
  const proposalTotal = periodExpenses.reduce((sum, expense) => sum + Number(expense.buyer?.value || 0), 0);
  const difference = requestedTotal - proposalTotal;

  document.querySelector('#requested-total').textContent = currency.format(requestedTotal);
  document.querySelector('#proposal-total').textContent = currency.format(proposalTotal);
  document.querySelector('#difference-total').textContent = currency.format(difference);
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
    row.requested += Number(expense.requester?.value || 0);
    row.proposal += Number(expense.buyer?.value || 0);
    byProduct.set(key, row);
  }

  reportTableBody.replaceChildren();
  for (const row of [...byProduct.values()].sort((a, b) => a.product.localeCompare(b.product, 'pt-BR'))) {
    const tableRow = document.createElement('tr');
    const values = [
      row.product,
      currency.format(row.requested),
      currency.format(row.proposal),
      currency.format(row.requested - row.proposal)
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
  detail.textContent = `${label} · ${currency.format(Number(record.value || 0))}`;
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
    removeButton.className = 'delete-button';
    removeButton.type = 'button';
    removeButton.textContent = 'Excluir';
    removeButton.setAttribute('aria-label', `Excluir registro de ${expense.requester?.product || 'produto'}`);
    removeButton.addEventListener('click', () => removeExpense(expense.id, removeButton));

    card.append(date, requester, buyer, removeButton);
    historyList.append(card);
  }
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
  const requesterValue = Number(fields.get('requesterValue'));
  const buyerValue = Number(fields.get('buyerValue'));
  if (!isAllowedLink(String(fields.get('requesterLink')).trim())
    || !isAllowedLink(String(fields.get('buyerLink')).trim())) {
    setFeedback(formMessage, 'Os links devem usar os endereços http:// ou https://.', 'error');
    return;
  }
  if (!Number.isFinite(requesterValue) || requesterValue < 0 || !Number.isFinite(buyerValue) || buyerValue < 0) {
    setFeedback(formMessage, 'Informe valores válidos, iguais ou maiores que zero.', 'error');
    return;
  }

  const entry = {
    date: fields.get('date'),
    requester: {
      sector: String(fields.get('requesterSector')).trim(),
      site: String(fields.get('requesterSite')).trim(),
      link: String(fields.get('requesterLink')).trim(),
      product: String(fields.get('requesterProduct')).trim(),
      value: requesterValue
    },
    buyer: {
      sector: String(fields.get('buyerSector')).trim(),
      site: String(fields.get('buyerSite')).trim(),
      link: String(fields.get('buyerLink')).trim(),
      product: String(fields.get('buyerProduct')).trim(),
      value: buyerValue
    },
    createdAt: serverTimestamp()
  };

  saveButton.disabled = true;
  setFeedback(formMessage, 'Salvando comparativo...');
  try {
    await addDoc(getExpensesCollection(activeUserId), entry);
    expenseForm.reset();
    document.querySelector('#entry-date').value = [
      currentDate.getFullYear(),
      String(currentDate.getMonth() + 1).padStart(2, '0'),
      String(currentDate.getDate()).padStart(2, '0')
    ].join('-');
    setFeedback(formMessage, 'Comparativo salvo com sucesso.', 'success');
  } catch (error) {
    setFeedback(formMessage, getFriendlyError(error), 'error');
  } finally {
    saveButton.disabled = false;
  }
});

reportType.addEventListener('change', () => {
  const isMonthly = reportType.value === 'month';
  monthControl.classList.toggle('hidden', !isMonthly);
  yearControl.classList.toggle('hidden', isMonthly);
  renderReport();
});

reportMonth.addEventListener('input', renderReport);
reportYear.addEventListener('input', renderReport);

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
