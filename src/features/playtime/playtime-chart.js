const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const width = 800;
const height = 400;

const chartCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: '#2b2d31' // Discord dark theme background
});

async function generatePlaytimeChart(dailyData, username, periodLabel) {
    // Cap each day at 24h max (1440 minutes) as safety net
    const cappedData = dailyData.map(d => ({ ...d, minutes: Math.min(d.minutes, 1440) }));
    const hoursData = cappedData.map(d => Math.round(d.minutes / 60 * 10) / 10);
    const totalMinutes = cappedData.reduce((sum, d) => sum + d.minutes, 0);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalMins = totalMinutes % 60;
    const dailyAvg = cappedData.length > 0 ? Math.round(totalMinutes / cappedData.length) : 0;
    const avgH = Math.floor(dailyAvg / 60);
    const avgM = dailyAvg % 60;
    const highest = cappedData.length > 0 ? Math.max(...cappedData.map(d => d.minutes)) : 0;
    const highestH = Math.floor(highest / 60);
    const highestM = highest % 60;
    const lowest = cappedData.length > 0 ? Math.min(...cappedData.map(d => d.minutes)) : 0;
    const lowestH = Math.floor(lowest / 60);
    const lowestM = lowest % 60;

    const subtitle = `Total: ${totalHours}h ${totalMins}m  |  Daily avg: ${avgH}h ${avgM}m  |  Highest: ${highestH}h ${highestM}m  |  Lowest: ${lowestH}h ${lowestM}m`;

    const config = {
        type: 'bar',
        data: {
            labels: dailyData.map(d => d.label),
            datasets: [{
                label: 'Hours played',
                data: hoursData,
                backgroundColor: '#00BFFF88',
                borderColor: '#00BFFF',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: [`${username}'s Playtime — ${periodLabel}`, subtitle],
                    color: '#ffffff',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false },
                subtitle: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#aaaaaa', font: { size: 11 } },
                    grid: { color: '#3a3c4233' }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#aaaaaa',
                        callback: (val) => `${val}h`
                    },
                    grid: { color: '#3a3c4266' }
                }
            }
        }
    };

    return await chartCanvas.renderToBuffer(config);
}

async function generateLeaderboardChart(players, periodLabel) {
    const config = {
        type: 'bar',
        data: {
            labels: players.map(p => p.username),
            datasets: [{
                label: 'Hours played',
                data: players.map(p => Math.round(p.total_minutes / 60 * 10) / 10),
                backgroundColor: '#00BFFF88',
                borderColor: '#00BFFF',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: `Guild Activity — ${periodLabel}`,
                    color: '#ffffff',
                    font: { size: 18, weight: 'bold' }
                },
                legend: { display: false }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: '#aaaaaa',
                        callback: (val) => `${val}h`
                    },
                    grid: { color: '#3a3c4266' }
                },
                y: {
                    ticks: { color: '#ffffff', font: { size: 12 } },
                    grid: { display: false }
                }
            }
        }
    };

    return await chartCanvas.renderToBuffer(config);
}

module.exports = { generatePlaytimeChart, generateLeaderboardChart };
