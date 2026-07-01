const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const width = 800;
const height = 400;

const chartCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: '#2b2d31'
});

async function generateWarsChart(dailyData, username, periodLabel) {
    const totalGained = dailyData.reduce((sum, d) => sum + d.gained, 0);
    const dailyAvg = dailyData.length > 0 ? Math.round(totalGained / dailyData.length) : 0;
    const highest = Math.max(...dailyData.map(d => d.gained));
    const lowest = Math.min(...dailyData.map(d => d.gained));

    const subtitle = `Total: +${totalGained}  |  Daily avg: +${dailyAvg}  |  Highest: +${highest}  |  Lowest: +${lowest}`;

    const config = {
        type: 'bar',
        data: {
            labels: dailyData.map(d => d.label),
            datasets: [{
                label: 'Wars gained',
                data: dailyData.map(d => d.gained),
                backgroundColor: '#FF444488',
                borderColor: '#FF4444',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: [`${username}'s Wars — ${periodLabel}`, subtitle],
                    color: '#ffffff',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: '#aaaaaa', font: { size: 11 } },
                    grid: { color: '#3a3c4233' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#aaaaaa' },
                    grid: { color: '#3a3c4266' }
                }
            }
        }
    };

    return await chartCanvas.renderToBuffer(config);
}

async function generateWarsLeaderboardChart(players, periodLabel, isAllTime) {
    const config = {
        type: 'bar',
        data: {
            labels: players.map(p => p.username),
            datasets: [{
                label: isAllTime ? 'Total wars' : 'Wars gained',
                data: players.map(p => isAllTime ? p.wars : p.gained),
                backgroundColor: '#FF444488',
                borderColor: '#FF4444',
                borderWidth: 2,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: `Wars Leaderboard — ${periodLabel}`,
                    color: '#ffffff',
                    font: { size: 18, weight: 'bold' }
                },
                legend: { display: false }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: '#aaaaaa' },
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

module.exports = { generateWarsChart, generateWarsLeaderboardChart };
