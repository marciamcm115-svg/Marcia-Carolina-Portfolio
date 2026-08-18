const fs = require('fs');
const path = require('path');
const https = require('https');

// Token passed from GitHub Actions environment variable
const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const API_VERSION = 'v19.0';

if (!ACCESS_TOKEN) {
    console.error("ERROR: IG_ACCESS_TOKEN is not set in environment variables.");
    process.exit(1);
}

function fetchIgData(mediaId) {
    return new Promise((resolve, reject) => {
        const url = `https://graph.facebook.com/${API_VERSION}/${mediaId}?fields=play_count,like_count,comments_count,saved_count,shares_count,media_type&access_token=${ACCESS_TOKEN}`;
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`API Error ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function main() {
    const rootDir = path.join(__dirname, '..');
    const configPath = path.join(rootDir, 'images.config.json');
    
    if (!fs.existsSync(configPath)) {
        console.error(`Config file not found at ${configPath}`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let changesMade = false;

    for (const projectId of config.projects) {
        const infoPath = path.join(rootDir, 'images', 'projects', projectId, 'info.json');
        if (!fs.existsSync(infoPath)) continue;

        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

        if (info.instagram_sync && info.instagram_sync.media_id) {
            console.log(`Syncing project: ${projectId} (Media ID: ${info.instagram_sync.media_id})`);
            try {
                const apiData = await fetchIgData(info.instagram_sync.media_id);
                console.log(`Fetched data:`, apiData);

                let statsUpdated = false;
                
                if (info.instagram_sync.mapping) {
                    // Mappings exist: array of { api_field: "play_count", lbl: "Visualizaciones" }
                    const newStatsMap = {};
                    
                    // Aggregate fields like "engagement" = like + comments + saved + shares
                    let engagement = (apiData.like_count || 0) + (apiData.comments_count || 0) + (apiData.saved_count || 0) + (apiData.shares_count || 0);

                    for (const map of info.instagram_sync.mapping) {
                        let val = 0;
                        if (map.api_field === 'engagement') val = engagement;
                        else if (map.api_field === 'play_count') val = apiData.play_count || 0;
                        else val = apiData[map.api_field] || 0;

                        newStatsMap[map.lbl] = formatNumber(val);
                    }

                    if (!info.stats) info.stats = [];
                    
                    for (const map of info.instagram_sync.mapping) {
                        const existing = info.stats.find(s => s.lbl === map.lbl);
                        if (existing) {
                            if (existing.n !== newStatsMap[map.lbl]) {
                                existing.n = newStatsMap[map.lbl];
                                statsUpdated = true;
                            }
                        } else {
                            info.stats.push({ n: newStatsMap[map.lbl], lbl: map.lbl });
                            statsUpdated = true;
                        }
                    }
                }

                if (statsUpdated) {
                    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + '\n', 'utf8');
                    console.log(`✅ Updated stats for ${projectId}`);
                    changesMade = true;
                } else {
                    console.log(`No changes needed for ${projectId}`);
                }

            } catch (error) {
                console.error(`❌ Failed to sync ${projectId}:`, error.message);
            }
        }
    }

    if (changesMade) {
        console.log("Sync complete: Modifications were written to info.json files.");
    } else {
        console.log("Sync complete: No modifications needed.");
    }
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
