import { supabase } from '../auth/supabase.js';

const tableBody = document.querySelector("#queryTable tbody");
const topQueriesList = document.querySelector("#topQueriesList");
const ctx = document.getElementById('queriesChart').getContext('2d');
const chartTypeSelect = document.getElementById('chartTypeSelect');
const exportBtn = document.getElementById('exportBtn');
const loadingOverlay = document.querySelector('.loading-overlay');
const sortField = document.getElementById('sortField');
const sortOrder = document.getElementById('sortOrder');
const activityFilter = document.getElementById('activityFilter');
const queryFilter = document.getElementById('queryFilter');
const startDate = document.getElementById('startDate');
const endDate = document.getElementById('endDate');
const resetFilters = document.getElementById('resetFilters');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const rowsPerPageSelect = document.getElementById('rowsPerPage');

let currentChartType = 'line';
let chart;
let chartLabels = [];
let chartData = [];
let originalData = [];
let filteredData = [];
let currentPage = 1;
let rowsPerPage = 10;

// Ensure Chart.js is loaded before proceeding
async function initChart() {
  if (typeof Chart === 'undefined') {
    console.error('Chart.js failed to load');
    tableBody.innerHTML = `<tr><td colspan="4">Chart library failed to load</td></tr>`;
    document.body.classList.remove('content-loading');
    loadingOverlay.classList.add('hidden');
    return;
  }

  await fetchQueries();
}

async function fetchQueries() {
  const startTime = Date.now();
  const minLoadingTime = 1000; // 1 second
  const maxLoadingTime = 5000; // 5 seconds fallback

  // Fallback to hide loader if fetch hangs
  const timeout = setTimeout(() => {
    console.warn('Fetch timed out after 5 seconds');
    tableBody.innerHTML = `<tr><td colspan="4">Failed to load queries: Request timed out</td></tr>`;
    document.body.classList.remove('content-loading');
    loadingOverlay.classList.add('hidden');
  }, maxLoadingTime);

  try {
    const { data, error } = await supabase
      .from('user_queries')
      .select('email, query, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      console.warn('No queries found in Supabase');
      tableBody.innerHTML = `<tr><td colspan="4">No queries found.</td></tr>`;
      topQueriesList.innerHTML = `<li class="no-data">No queries found.</li>`;
      return;
    }

    originalData = data;
    filteredData = [...data];
    updateTableAndChart();
  } catch (error) {
    console.error('Error fetching queries:', error.message);
    tableBody.innerHTML = `<tr><td colspan="4">Failed to load queries: ${error.message}</td></tr>`;
    topQueriesList.innerHTML = `<li class="no-data">Error: ${error.message}</li>`;
  } finally {
    clearTimeout(timeout);
    // Ensure minimum loading time
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
    // Apply filters
    let data = [...originalData];
    
    // Query filter
    const queryValue = queryFilter.value.trim().toLowerCase();
    if (queryValue) {
      data = data.filter(item => item.query.toLowerCase().includes(queryValue));
    }

    // Date range filter
    const start = startDate.value ? new Date(startDate.value) : null;
    const end = endDate.value ? new Date(endDate.value) : null;
    if (start) {
      data = data.filter(item => new Date(item.created_at) >= start);
    }
    if (end) {
      end.setHours(23, 59, 59, 999);
      data = data.filter(item => new Date(item.created_at) <= end);
    }

    // Activity filter
    const activityValue = activityFilter.value;
    if (activityValue !== 'all') {
      // Calculate query counts per email
      const countsByEmail = {};
      originalData.forEach(item => {
        countsByEmail[item.email] = (countsByEmail[item.email] || 0) + 1;
      });
      const emailCounts = Object.entries(countsByEmail).map(([email, count]) => ({ email, count }));
      emailCounts.sort((a, b) => b.count - a.count);
      
      // Determine thresholds (top/bottom 25%)
      const counts = emailCounts.map(item => item.count);
      const sortedCounts = [...counts].sort((a, b) => a - b);
      const highThreshold = sortedCounts[Math.floor(sortedCounts.length * 0.75)] || 1;
      const lowThreshold = sortedCounts[Math.floor(sortedCounts.length * 0.25)] || 0;

      // Filter emails based on activity
      const filteredEmails = emailCounts
        .filter(item => activityValue === 'high' ? item.count >= highThreshold : item.count <= lowThreshold)
        .map(item => item.email);
      data = data.filter(item => filteredEmails.includes(item.email));
    }

    // Apply sorting
    const field = sortField.value;
    const order = sortOrder.value;
    data.sort((a, b) => {
      let valA = a[field];
      let valB = b[field];
      if (field === 'time') {
        valA = new Date(valA);
        valB = new Date(valB);
      } else {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      return order === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    filteredData = data;

    // Paginate data
    const totalRows = filteredData.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage);
    currentPage = Math.min(currentPage, totalPages || 1); // Ensure currentPage is valid
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedData = filteredData.slice(startIndex, endIndex);

    // Populate main table
    tableBody.innerHTML = "";
    if (paginatedData.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4">No matching queries found.</td></tr>`;
    } else {
      paginatedData.forEach((item, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${startIndex + index + 1}</td>
          <td>${item.email}</td>
          <td>${item.query}</td>
          <td>${new Date(item.created_at).toLocaleString()}</td>
        `;
        tableBody.appendChild(row);
      });
    }

    // Update pagination info
    pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;

    // Populate top keywords analysis
    const keywords = ['AFP', 'ACUTE FLACCID PARALYSIS', 'POLIO', 'POLIO VIRUS', 'SURVEILLANCE'];
    const countsByKeyword = {};
    keywords.forEach(keyword => {
      countsByKeyword[keyword] = 0;
    });
    filteredData.forEach(item => {
      const queryLower = item.query.toLowerCase();
      keywords.forEach(keyword => {
        if (queryLower.includes(keyword.toLowerCase())) {
          countsByKeyword[keyword] = (countsByKeyword[keyword] || 0) + 1;
        }
      });
    });
    const keywordCounts = Object.entries(countsByKeyword)
      .map(([keyword, count]) => ({ keyword, count }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
      .slice(0, 5); // Top 5 keywords
    topQueriesList.innerHTML = "";
    if (keywordCounts.length === 0) {
      topQueriesList.innerHTML = `<li class="no-data">No matching keywords found.</li>`;
    } else {
      keywordCounts.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `
          <span class="keyword-text">${item.keyword}</span>
          <span class="keyword-count">${item.count}</span>
        `;
        li.dataset.keyword = item.keyword;
        topQueriesList.appendChild(li);
      });
    }

    // Update chart (time-based)
    const countsByDay = {};
    filteredData.forEach(item => {
      const day = new Date(item.created_at).toISOString().split('T')[0];
      countsByDay[day] = (countsByDay[day] || 0) + 1;
    });
    chartLabels = Object.keys(countsByDay).sort();
    chartData = chartLabels.map(day => countsByDay[day]);
    renderChart();
  } catch (error) {
    console.error('Error updating table and chart:', error.message);
    tableBody.innerHTML = `<tr><td colspan="4">Error rendering data: ${error.message}</td></tr>`;
    topQueriesList.innerHTML = `<li class="no-data">Error: ${error.message}</li>`;
  }
}

function getChartConfig() {
  const isPieOrDoughnut = ['pie', 'doughnut'].includes(currentChartType);
  // Create gradient for line and bar charts
  let backgroundColor;
  if (!isPieOrDoughnut) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, '#003087');
    gradient.addColorStop(1, '#60a5fa');
    backgroundColor = gradient;
  } else {
    backgroundColor = [
      '#003087',
      '#2563eb',
      '#60a5fa',
      '#93c5fd',
      '#1e40af',
      '#3b82f6',
      '#bfdbfe',
      '#1d4ed8',
      '#dbeafe',
      '#4b5e7e'
    ];
  }
  return {
    type: currentChartType,
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Polio Queries per Day',
        data: chartData,
        backgroundColor: backgroundColor,
        borderColor: isPieOrDoughnut ? 'rgba(0, 48, 135, 0.2)' : '#003087',
        borderWidth: isPieOrDoughnut ? 4 : 1,
        fill: currentChartType === 'line',
        tension: currentChartType === 'line' ? 0.3 : 0,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#003087',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        shadowOffsetX: 2,
        shadowOffsetY: 2,
        shadowBlur: 5,
        shadowColor: 'rgba(0, 48, 135, 0.2)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1000,
        easing: 'easeInOutCubic'
      },
      plugins: {
        legend: {
          display: true,
          position: isPieOrDoughnut ? 'right' : 'top',
          labels: {
            font: { family: 'Inter', weight: '600', size: 14 },
            color: '#1e2a44',
            padding: 15,
            usePointStyle: true
          }
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 48, 135, 0.8)',
          titleFont: { family: 'Inter', weight: '600', size: 14 },
          bodyFont: { family: 'Inter', weight: '500', size: 12 },
          cornerRadius: 8,
          padding: 12,
          callbacks: {
            label: (context) => `${context.label}: ${context.raw} queries`
          }
        }
      },
      scales: isPieOrDoughnut ? {} : {
        x: {
          title: { 
            display: true, 
            text: 'Date', 
            font: { family: 'Inter', weight: '600', size: 14 },
            color: '#1e2a44',
            padding: { top: 10 }
          },
          ticks: { 
            color: '#1e2a44',
            font: { family: 'Inter', weight: '500', size: 12 }
          },
          grid: {
            color: '#d1e0ff',
            borderDash: [5, 5]
          }
        },
        y: {
          beginAtZero: true,
          title: { 
            display: true, 
            text: 'Number of Queries', 
            font: { family: 'Inter', weight: '600', size: 14 },
            color: '#1e2a44',
            padding: { bottom: 10 }
          },
          ticks: { 
            color: '#1e2a44',
            font: { family: 'Inter', weight: '500', size: 12 },
            stepSize: 1
          },
          grid: {
            color: '#d1e0ff',
            borderDash: [5, 5]
          }
        }
      },
      elements: {
        arc: {
          borderWidth: isPieOrDoughnut ? 4 : 0,
          hoverOffset: 12
        }
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

function exportTableToCSV() {
  try {
    const rows = Array.from(document.querySelectorAll("#queryTable tr"));
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
    a.download = `polio_queries_${timestamp}.csv`;
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
    sortField.value = 'time';
    sortOrder.value = 'desc';
    activityFilter.value = 'all';
    queryFilter.value = '';
    startDate.value = '';
    endDate.value = '';
    currentPage = 1;
    filteredData = [...originalData];
    updateTableAndChart();
  } catch (error) {
    console.error('Error resetting filters:', error.message);
  }
}

function handleKeywordDoubleClick(event) {
  const keyword = event.currentTarget.dataset.keyword;
  if (keyword) {
    queryFilter.value = keyword;
    currentPage = 1; // Reset to first page
    updateTableAndChart();
  }
}

function changePage(direction) {
  currentPage += direction;
  updateTableAndChart();
}

function changeRowsPerPage() {
  rowsPerPage = parseInt(rowsPerPageSelect.value, 10);
  currentPage = 1; // Reset to first page
  updateTableAndChart();
}

// Event listeners
chartTypeSelect.addEventListener('change', changeChartType);
exportBtn.addEventListener('click', exportTableToCSV);
sortField.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
sortOrder.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
activityFilter.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
queryFilter.addEventListener('input', () => { currentPage = 1; updateTableAndChart(); });
startDate.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
endDate.addEventListener('change', () => { currentPage = 1; updateTableAndChart(); });
resetFilters.addEventListener('click', resetFiltersAndSort);
prevPageBtn.addEventListener('click', () => changePage(-1));
nextPageBtn.addEventListener('click', () => changePage(1));
rowsPerPageSelect.addEventListener('change', changeRowsPerPage);

// Add double-click event listeners to keyword list items
topQueriesList.addEventListener('dblclick', (event) => {
  const li = event.target.closest('li:not(.no-data)');
  if (li) handleKeywordDoubleClick(event);
});

// Initialize
initChart();