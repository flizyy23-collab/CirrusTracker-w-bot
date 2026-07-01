const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require('canvas');
const path = require('path');

const BASE_MAP_PATH = path.join(__dirname, '../../assets/main-map-small.png');
const HQ_IMAGE_PATH = path.join(__dirname, '../../assets/guild_headquarters.png');
const SCALE = 0.35;
const OFFSET_X = 2558;
const OFFSET_Z = 6638;
const VERY_HIGH_COLOR = '#00FFFF';

let cachedHqImage = null;

const FALLBACK_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F1948A', '#7DCEA0', '#F0B27A', '#AED6F1', '#D7BDE2',
    '#A3E4D7', '#FAD7A0', '#A9CCE3', '#D5F5E3', '#FADBD8',
    '#FF9FF3', '#54A0FF', '#5F27CD', '#01A3A4', '#F368E0',
    '#EE5253', '#10AC84', '#341F97', '#0ABDE3', '#FF9F43',
];

let cachedBaseMap = null;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('territory')
        .setDescription('Territory commands')
        .addSubcommand(sub =>
            sub.setName('map')
                .setDescription('View the current territory map')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Map type')
                        .addChoices(
                            { name: 'Normal Map', value: 'map' },
                            { name: 'Defenses', value: 'defense' },
                            { name: 'Treasury', value: 'treasury' },
                        ))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'map') {
            const mapType = interaction.options.getString('type') || 'map';
            return handleMap(interaction, mapType);
        }
    }
};

function coordToPixel(x, z) {
    return {
        px: Math.round((x + OFFSET_X) * SCALE),
        py: Math.round((z + OFFSET_Z) * SCALE)
    };
}

function hexToRgb(hex) {
    const normalized = hex.replace('#', '');
    const expanded = normalized.length === 3 ? normalized[0] + normalized[0] + normalized[1] + normalized[1] + normalized[2] + normalized[2] : normalized;
    return {
        r: parseInt(expanded.slice(0, 2), 16),
        g: parseInt(expanded.slice(2, 4), 16),
        b: parseInt(expanded.slice(4, 6), 16),
    };
}

async function handleMap(interaction, mapType) {
    await interaction.deferReply();

    try {
        const [terrRes, colorRes] = await Promise.allSettled([
            fetch('https://api.wynncraft.com/v3/guild/list/territory'),
            fetch('https://athena.wynntils.com/cache/get/guildList')
        ]);

        if (terrRes.status !== 'fulfilled' || !terrRes.value.ok) {
            return interaction.editReply({ content: '❌ Failed to fetch territory data.' });
        }
        const territories = await terrRes.value.json();

        const guildColorMap = {};
        if (colorRes.status === 'fulfilled' && colorRes.value.ok) {
            const guildList = await colorRes.value.json();
            for (const guild of guildList) {
                if (guild.prefix && guild.color) guildColorMap[guild.prefix] = guild.color;
            }
        }

        if (!cachedBaseMap) {
            try {
                cachedBaseMap = await loadImage(BASE_MAP_PATH);
            } catch (error) {
                console.error('Failed to load base map:', error.message);
                return interaction.editReply({ content: '❌ Base map image not found.' });
            }
        }

        const mapWidth = cachedBaseMap.width;
        const mapHeight = cachedBaseMap.height;
        const guildCounts = {};
        const guildNames = {};
        let fallbackIdx = 0;

        for (const territory of Object.values(territories)) {
            const prefix = territory.guild.prefix || 'None';
            if (!guildCounts[prefix]) {
                guildCounts[prefix] = 0;
                guildNames[prefix] = territory.guild.name;
            }
            guildCounts[prefix]++;

            if (!guildColorMap[prefix]) {
                guildColorMap[prefix] = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
                fallbackIdx++;
            }
        }

        const sortedGuilds = Object.entries(guildCounts).map(([prefix, count]) => ({ prefix, name: guildNames[prefix], count })).sort((a, b) => b.count - a.count);
        const canvas = createCanvas(mapWidth, mapHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(cachedBaseMap, 0, 0);
        let hqPastes = [];

        const defenseColorMap = {
            very_low: '#006400', low: '#228B22', medium: '#FFD700', high: '#FF0000', very_high: VERY_HIGH_COLOR
        };
        const treasuryColorMap = {
            very_low: '#006400', low: '#228B22', medium: '#FFD700', high: '#FF0000', very_high: VERY_HIGH_COLOR
        };

        for (const territory of Object.values(territories)) {
            const prefix = territory.guild.prefix || 'None';
            let colorHex;
            if (mapType === 'defense') colorHex = defenseColorMap[(territory.defences || '').toLowerCase()] || '#FFFFFF';
            else if (mapType === 'treasury') colorHex = treasuryColorMap[(territory.treasury || '').toLowerCase()] || '#FFFFFF';
            else colorHex = guildColorMap[prefix] || '#FFFFFF';
            const rgb = hexToRgb(colorHex);

            const startX = territory.location.start[0];
            const startZ = territory.location.start[1];
            const endX = territory.location.end[0];
            const endZ = territory.location.end[1];
            const p1 = coordToPixel(Math.min(startX, endX), Math.min(startZ, endZ));
            const p2 = coordToPixel(Math.max(startX, endX), Math.max(startZ, endZ));

            const x = Math.max(0, p1.px);
            const y = Math.max(0, p1.py);
            const w = Math.min(p2.px, mapWidth) - x;
            const h = Math.min(p2.py, mapHeight) - y;
            if (w <= 0 || h <= 0) continue;

            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            ctx.lineWidth = Math.round(8 * SCALE);
            ctx.strokeRect(x, y, w, h);

            if (w > 20 && h > 12) {
                const fontSize = Math.round(40 * SCALE);
                const cx = x + w / 2;
                const cy = y + h / 2;
                const hasHq = Boolean(territory.hq);

                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                if (hasHq) {
                    // HQ crown drawn after all territories (collected for later)
                    if (!hqPastes) hqPastes = [];
                    const crownSize = Math.round(Math.min(w, h, Math.round(80 * SCALE)) / 1.5);
                    hqPastes.push({ cx, cy, size: crownSize });
                } else {
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 2;
                    ctx.strokeText(prefix, cx, cy);
                    ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                    ctx.fillText(prefix, cx, cy);
                }
            }
        }

        // Draw HQ crowns on top of everything
        if (hqPastes.length > 0) {
            if (!cachedHqImage) {
                try { cachedHqImage = await loadImage(HQ_IMAGE_PATH); } catch (e) { console.error('Failed to load HQ image:', e.message); }
            }
            for (const hq of hqPastes) {
                if (cachedHqImage) {
                    const crownW = hq.size;
                    const crownH = Math.round(hq.size * cachedHqImage.height / cachedHqImage.width);
                    ctx.drawImage(cachedHqImage, hq.cx - crownW / 2, hq.cy - crownH / 2, crownW, crownH);
                } else {
                    // Fallback: draw gold "HQ" text
                    ctx.font = `bold ${Math.round(12)}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 2;
                    ctx.strokeText('HQ', hq.cx, hq.cy);
                    ctx.fillStyle = '#FFD700';
                    ctx.fillText('HQ', hq.cx, hq.cy);
                }
            }
        }

        if (mapType === 'defense' || mapType === 'treasury') {
            const levels = [
                { label: 'Very High', color: VERY_HIGH_COLOR },
                { label: 'High', color: '#FF0000' },
                { label: 'Medium', color: '#FFD700' },
                { label: 'Low', color: '#228B22' },
                { label: 'Very Low', color: '#006400' },
            ];
            const lineH = 18;
            const legendH = levels.length * lineH + 25;
            const legendW = 140;

            ctx.fillStyle = 'rgba(80, 80, 80, 0.85)';
            ctx.fillRect(8, 8, legendW, legendH);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(8, 8, legendW, legendH);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(mapType === 'defense' ? 'Defenses' : 'Treasury', 15, 12);

            for (let i = 0; i < levels.length; i++) {
                const y = 30 + i * lineH;
                ctx.fillStyle = levels[i].color;
                ctx.fillRect(15, y, 10, 10);
                ctx.fillStyle = '#ffffff';
                ctx.font = '11px sans-serif';
                ctx.fillText(levels[i].label, 30, y);
            }
        } else {
            const maxLegendGuilds = 25;
            const lineH = Math.round(40 * SCALE) + 4;
            const legendH = Math.min(sortedGuilds.length, maxLegendGuilds) * lineH + 30;
            const legendW = Math.round(350 * SCALE) + 80;

            ctx.fillStyle = 'rgba(80, 80, 80, 0.85)';
            ctx.fillRect(8, 8, legendW, legendH);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(8, 8, legendW, legendH);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            const displayGuilds = sortedGuilds.slice(0, maxLegendGuilds);
            for (let i = 0; i < displayGuilds.length; i++) {
                const guild = displayGuilds[i];
                const y = 15 + i * lineH;
                const colorHex = guildColorMap[guild.prefix] || '#FFFFFF';
                const rgb = hexToRgb(colorHex);
                const text = `${i + 1}. ${guild.name} (${guild.prefix}) — ${guild.count}`;
                ctx.font = '11px sans-serif';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.strokeText(text, 15, y);
                ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                ctx.fillText(text, 15, y);
            }
        }

        const buffer = canvas.toBuffer('image/png');
        const attachment = new AttachmentBuilder(buffer, { name: 'territory-map.png' });
        const typeLabels = { map: 'Normal', defense: 'Defenses', treasury: 'Treasury' };
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`Territory Map — ${typeLabels[mapType]}`)
            .setImage('attachment://territory-map.png')
            .setFooter({ text: 'Wynncraft Territory Map • Live data' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
        console.error('Error generating territory map:', error);
        await interaction.editReply({ content: '❌ Failed to generate territory map.' });
    }
}
