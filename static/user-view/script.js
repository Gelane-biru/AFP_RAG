import { supabase } from '../auth/supabase.js';

// Load Chart.js dynamically with fallback
async function loadChartJS() {
  return new Promise((resolve, reject) => {
    const primaryScript = document.createElement('script');
    primaryScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
    primaryScript.onload = () => resolve(window.Chart);
    primaryScript.onerror = () => {
      const fallbackScript = document.createElement('script');
      fallbackScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js';
      fallbackScript.onload = () => resolve(window.Chart);
      fallbackScript.onerror = () => {
        console.error('Both Chart.js CDNs failed to load');
        reject(new Error('Chart.js failed to load from all sources'));
      };
      document.body.appendChild(fallbackScript);
    };
    document.body.appendChild(primaryScript);
  });
}

const tableBody = document.querySelector("#usersTable tbody");
const ctx = document.getElementById('usersChart').getContext('2d');
const chartTypeSelect = document.getElementById('chartTypeSelect');
const graphViewSelect = document.getElementById('graphViewSelect');
const timeRangeSelect = document.getElementById('timeRangeSelect');
const exportBtn = document.getElementById('exportBtn');
const loadingOverlay = document.querySelector('.loading-overlay');
const sortField = document.getElementById('sortField');
const sortOrder = document.getElementById('sortOrder');
const startDate = document.getElementById('startDate');
const endDate = document.getElementById('endDate');
const resetFilters = document.getElementById('resetFilters');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const rowsPerPageSelect = document.getElementById('rowsPerPage');
const editModal = document.getElementById('editModal');
const closeModal = document.getElementById('closeModal');
const saveEdit = document.getElementById('saveEdit');
const cancelEdit = document.getElementById('cancelEdit');
const editName = document.getElementById('editName');
const editEmail = document.getElementById('editEmail');
const editCreatedAt = document.getElementById('editCreatedAt');
const editUserId = document.getElementById('editUserId');

let currentChartType = 'line';
let currentGraphView = 'year';
let chart;
let chartLabels = [];
let chartData = [];
let originalData = [];
let filteredData = [];
let currentPage = 1;
let rowsPerPage = 10;

async function initChart() {
  try {
    window.Chart = await loadChartJS();
    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js failed to load');
    }
    await fetchUsers();
  } catch (error) {
    console.error(error.message);
    tableBody.innerHTML = `<tr><td colspan="5">Chart library failed to load. Please check your internet connection or try again later.</td></tr>`;
    document.body.classList.remove('content-loading');
    loadingOverlay.classList.add('hidden');
  }
}

async function fetchUsers() {
  const startTime = Date.now();
  const minLoadingTime = 1000;
  const maxLoadingTime = 5000;

  const timeout = setTimeout(() => {
    console.warn('Fetch timed out after 5 seconds');
    tableBody.innerHTML = `<tr><td colspan="5">Failed to load users: Request timed out</td></tr>`;
    document.body.classList.remove('content-loading');
    loadingOverlay.classList.add('hidden');
  }, maxLoadingTime);

  try {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, email, created_at');

    if (profilesError) {
      console.error('Supabase profiles error:', profilesError);
      throw new Error(profilesError.message);
    }

    if (!profiles || profiles.length === 0) {
      console.warn('No users found in Supabase');
      tableBody.innerHTML = `<tr><td colspan="5">No users found.</td></tr>`;
      return;
    }

    originalData = profiles.map(profile => ({
      id: profile.id,
      name: profile.name || 'No Name',
      email: profile.email,
      created_at: profile.created_at
    }));

    filteredData = [...originalData];
    updateTableAndChart();
  } catch (error) {
    console.error('Error fetching users:', error.message);
    tableBody.innerHTML = `<tr><td colspan="5">Failed to load users: ${error.message}</td></tr>`;
  } finally {
    clearTimeout(timeout);
    const elapsed = Date.now() - startTime;
    if (elapsed < minLoadingTime) {
      await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsed));
    }
    document.body.classList.remove('content-loading');
    loadingOverlay.classList.add('hidden');
  }
}

function updateTableAndChart() {
  try {
    let data = [...originalData];

    const timeRange = timeRangeSelect.value;
    if (timeRange !== 'all') {
      const now = new Date('2025-07-15T03:26:00Z');
      let timeFilter;
      switch (timeRange) {
        case 'day': timeFilter = new Date(now - 24 * 60 * 60 * 1000); break;
        case 'week': timeFilter = new Date(now - 7 * 24 * 60 * 60 * 1000); break;
        case 'month': timeFilter = new Date(now - 30 * 24 * 60 * 60 * 1000); break;
        case '3month': timeFilter = new Date(now - 90 * 24 * 60 * 60 * 1000); break;
        case '6month': timeFilter = new Date(now - 180 * 24 * 60 * 60 * 1000); break;
        case 'year': timeFilter = new Date(now - 365 * 24 * 60 * 60 * 1000); break;
      }
      if (timeFilter) data = data.filter(item => new Date(item.created_at) >= timeFilter);
    }

    const start = startDate.value ? new Date(startDate.value) : null;
    const end = endDate.value ? new Date(endDate.value) : null;
    if (start) data = data.filter(item => new Date(item.created_at) >= start);
    if (end) {
      end.setHours(23, 59, 59, 999);
      data = data.filter(item => new Date(item.created_at) <= end);
    }

    const field = sortField.value;
    const order = sortOrder.value;
    data.sort((a, b) => {
      let valA = a[field].toLowerCase();
      let valB = b[field].toLowerCase();
      return order === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    filteredData = data;

    const totalRows = filteredData.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage);
    currentPage = Math.min(currentPage, totalPages || 1);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedData = filteredData.slice(startIndex, endIndex);

    tableBody.innerHTML = "";
    if (paginatedData.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5">No matching users found.</td></tr>`;
    } else {
      paginatedData.forEach((item, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${startIndex + index + 1}</td>
          <td>${item.name}</td>
          <td>${item.email}</td>
          <td>${new Date(item.created_at).toLocaleString()}</td>
          <td><button class="edit-btn" data-id="${item.id}">Edit</button></td>
        `;
        tableBody.appendChild(row);
      });
    }

    pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;

    const countsByPeriod = {};
    filteredData.forEach(item => {
      const createdAt = new Date(item.created_at);
      let period;
      switch (currentGraphView) {
        case 'year': period = createdAt.getFullYear().toString(); break;
        case 'month': period = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`; break;
        case 'week': const weekStart = new Date(createdAt.setDate(createdAt.getDate() - createdAt.getDay())); period = weekStart.toISOString().split('T')[0]; break;
        case 'day': period = createdAt.toISOString().split('T')[0]; break;
      }
      countsByPeriod[period] = (countsByPeriod[period] || 0) + 1;
    });
    chartLabels = Object.keys(countsByPeriod).sort();
    chartData = chartLabels.map(period => countsByPeriod[period]);
    renderChart();
  } catch (error) {
    console.error('Error updating table and chart:', error.message);
    tableBody.innerHTML = `<tr><td colspan="5">Error rendering data: ${error.message}</td></tr>`;
  }
}

function getChartConfig() {
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, '#003087');
  gradient.addColorStop(1, '#b3c5e6');
  const backgroundColor = gradient;

  return {
    type: currentChartType,
    data: {
      labels: chartLabels,
      datasets: [{
        label: `New Users per ${currentGraphView.charAt(0).toUpperCase() + currentGraphView.slice(1)}`,
        data: chartData,
        backgroundColor: backgroundColor,
        borderColor: '#003087',
        borderWidth: 2,
        fill: currentChartType === 'line',
        tension: currentChartType === 'line' ? 0.3 : 0,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#003087',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeInOutQuad' },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { family: 'Inter', weight: '600', size: 14 }, color: '#1e2a44', padding: 12 } },
        tooltip: { enabled: true, backgroundColor: 'rgba(0, 48, 135, 0.9)', titleFont: { family: 'Inter', weight: '600', size: 14 }, bodyFont: { family: 'Inter', weight: '500', size: 12 }, cornerRadius: 6, padding: 10, callbacks: { label: (context) => `${context.label}: ${context.raw} new users` } }
      },
      scales: {
        x: { title: { display: true, text: currentGraphView.charAt(0).toUpperCase() + currentGraphView.slice(1), font: { family: 'Inter', weight: '600', size: 14 }, color: '#1e2a44' }, ticks: { color: '#1e2a44', font: { family: 'Inter', weight: '500', size: 12 } }, grid: { color: '#e0e7f5', borderDash: [4, 4] } },
        y: { beginAtZero: true, title: { display: true, text: 'Number of New Users', font: { family: 'Inter', weight: '600', size: 14 }, color: '#1e2a44' }, ticks: { color: '#1e2a44', font: { family: 'Inter', weight: '500', size: 12 }, stepSize: 1 }, grid: { color: '#e0e7f5', borderDash: [4, 4] } }
      }
    }
  };
}

function renderChart() {
  try {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js not available');
      return;
    }
    if (chart) chart.destroy();
    chart = new Chart(ctx, getChartConfig());
  } catch (error) {
    console.error('Error rendering chart:', error.message);
  }
}

function changeChartType() {
  currentChartType = chartTypeSelect.value;
  updateTableAndChart();
}

function changeGraphView() {
  currentGraphView = graphViewSelect.value;
  updateTableAndChart();
}

function exportTableToCSV() {
  try {
    const rows = Array.from(document.querySelectorAll("#usersTable tr"));
    if (rows.length <= 1) {
      alert("No data to export");
      return;
    }

    const csvRows = rows.map(row => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      return cells.map(cell => {
        const text = cell.innerText.replace(/"/g, '""');
        return `"${text}"`;
      }).join(",");
    });

    const csvContent = "\ufeff" + csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error exporting CSV:", error);
    alert("Failed to export CSV. Please try again.");
  }
}

function resetFiltersAndSort() {
  try {
    sortField.value = 'name';
    sortOrder.value = 'asc';
    startDate.value = '';
    endDate.value = '';
    timeRangeSelect.value = 'all';
    currentPage = 1;
    filteredData = [...originalData];
    updateTableAndChart();
  } catch (error) {
    console.error('Error resetting filters:', error.message);
  }
}

function changePage(direction) {
  currentPage += direction;
  updateTableAndChart();
}

function changeRowsPerPage() {
  rowsPerPage = parseInt(rowsPerPageSelect.value, 10);
  currentPage = 1;
  updateTableAndChart();
}

async function updateUser(id, name, email, createdAt) {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ name, email, created_at: createdAt })
      .eq('id', id);

    if (error) throw error;
    alert('User updated successfully!');
    editModal.style.display = 'none';
    fetchUsers();
  } catch (error) {
    console.error('Error updating user:', error.message);
    alert('Failed to update user: ' + error.message);
  }
}

function openEditModal(id, name, email, createdAt) {
  editUserId.value = id;
  editName.value = name;
  editEmail.value = email;
  editCreatedAt.value = createdAt.split('T')[0];
  editModal.style.display = 'flex';
}

// Event listeners
chartTypeSelect.addEventListener('change', changeChartType);
graphViewSelect.addEventListener('change', changeGraphView);
timeRangeSelect.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
exportBtn.addEventListener('click', exportTableToCSV);
sortField.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
sortOrder.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
startDate.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
endDate.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
resetFilters.addEventListener('click', resetFiltersAndSort);
prevPageBtn.addEventListener('click', () => changePage(-1));
nextPageBtn.addEventListener('click', () => changePage(1));
rowsPerPageSelect.addEventListener('change', changeRowsPerPage);
closeModal.addEventListener('click', () => (editModal.style.display = 'none'));
cancelEdit.addEventListener('click', () => (editModal.style.display = 'none'));
saveEdit.addEventListener('click', () => {
  const id = editUserId.value;
  const name = editName.value;
  const email = editEmail.value;
  const createdAt = editCreatedAt.value + 'T00:00:00Z';
  updateUser(id, name, email, createdAt);
});

// Edit button event delegation
tableBody.addEventListener('click', (e) => {
  if (e.target.classList.contains('edit-btn')) {
    const id = e.target.getAttribute('data-id');
    const user = filteredData.find(u => u.id === id);
    if (user) openEditModal(user.id, user.name, user.email, user.created_at);
  }
});

// Initialize
initChart();