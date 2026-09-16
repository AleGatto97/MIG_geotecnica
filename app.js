// App Logic for Geotech Simulations

document.addEventListener('DOMContentLoaded', () => {
    initNumberInputWheelGuard();
    initTabs();
    initStressModule();
    initFondazioniModule();
    initGranulometriaModule();
    initSeepageModule();
    initEdometricModule();
    initShearModule();
});

// Impedisce che la rotellina del mouse cambi il valore di un campo numerico
// mentre il cursore vi passa sopra: i valori nei campi <input type="number">
// (tabelle di granulometria e sigma'p comprese) si devono poter modificare
// solo da tastiera o con le frecce del campo, non "per sbaglio" scorrendo la
// pagina con la rotellina. Un solo listener delegato sul documento copre
// anche i campi creati dinamicamente (righe aggiunte alle tabelle).
function initNumberInputWheelGuard() {
    document.addEventListener('wheel', () => {
        const el = document.activeElement;
        if (el && el.tagName === 'INPUT' && el.type === 'number') {
            el.blur();
        }
    }, { passive: true });
}

function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('[data-tab-panel]');
    const emptyState = document.getElementById('tabs-empty-state');

    function activate(tabName) {
        buttons.forEach(btn => {
            const isActive = btn.dataset.tab === tabName;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panels.forEach(panel => {
            panel.hidden = panel.dataset.tabPanel !== tabName;
        });
        if (emptyState) emptyState.hidden = true;
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', () => activate(btn.dataset.tab));
    });

    // Nessuna scheda aperta di default: bisogna cliccarne una per iniziare.
    panels.forEach(panel => { panel.hidden = true; });
}

function initStressModule() {
    // Inputs
    const hwInput = document.getElementById('hw');
    const z1Input = document.getElementById('z1');
    const gamma1Input = document.getElementById('gamma1');
    const gamma1SatInput = document.getElementById('gamma1-sat');
    const gamma2SatInput = document.getElementById('gamma2-sat');

    // Values displays
    const valHw = document.getElementById('val-hw');
    const valZ1 = document.getElementById('val-z1');
    const valGamma1 = document.getElementById('val-gamma1');
    const valGamma1Sat = document.getElementById('val-gamma1-sat');
    const valGamma2Sat = document.getElementById('val-gamma2-sat');

    // Chart instance
    let stressChart = null;
    const ctx = document.getElementById('stressChart').getContext('2d');

    // Constants
    const gammaW = 9.81;
    const maxDepth = 10; // m

    // Piccolo triangolo disegnato sopra la linea tratteggiata "Falda (h_w)": la sua
    // posizione verticale viene ricalcolata a ogni ridisegno dallo stesso valore usato
    // per la linea, quindi scende e sale insieme ad essa muovendo lo slider.
    const waterTableMarkerPlugin = {
        id: 'waterTableMarker',
        afterDatasetsDraw(chart) {
            const { ctx, scales, chartArea } = chart;
            const hwDataset = chart.data.datasets[3]; // 'Falda (h_w)'
            if (!hwDataset || !hwDataset.data || !hwDataset.data.length) return;
            const hwValue = hwDataset.data[0].y;
            if (!Number.isFinite(hwValue)) return;

            const yPixel = scales.y.getPixelForValue(hwValue);
            const xPos = chartArea.right - 16;
            const halfWidth = 6;
            const height = 8;

            ctx.save();
            ctx.fillStyle = '#1E507F';
            ctx.beginPath();
            ctx.moveTo(xPos - halfWidth, yPixel - height);
            ctx.lineTo(xPos + halfWidth, yPixel - height);
            ctx.lineTo(xPos, yPixel);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    };

    function updateChart() {
        const hw = parseFloat(hwInput.value);
        const z1 = parseFloat(z1Input.value);
        const gamma1 = parseFloat(gamma1Input.value);

        // gamma_sat must always be >= gamma (dry): saturating a soil adds water into the
        // voids in place of air, so it can only increase (never decrease) the unit weight.
        // Clamp the slider itself so this invalid combination can't be selected.
        gamma1SatInput.min = gamma1;
        let gamma1Sat = parseFloat(gamma1SatInput.value);
        if (gamma1Sat < gamma1) {
            gamma1Sat = gamma1;
            gamma1SatInput.value = gamma1Sat;
        }

        const gamma2Sat = parseFloat(gamma2SatInput.value);

        // Update labels
        valHw.textContent = hw.toFixed(1);
        valZ1.textContent = z1.toFixed(1);
        valGamma1.textContent = gamma1.toFixed(1);
        valGamma1Sat.textContent = gamma1Sat.toFixed(1);
        valGamma2Sat.textContent = gamma2Sat.toFixed(1);

        // Build depths array: fine 0.1m grid PLUS the exact critical points
        const criticalDepths = new Set();
        for (let i = 0; i <= maxDepth * 10; i++) {
            criticalDepths.add(Math.round(i) / 10);
        }
        criticalDepths.add(parseFloat(hw.toFixed(2)));
        criticalDepths.add(parseFloat(z1.toFixed(2)));
        const depths = Array.from(criticalDepths).sort((a, b) => a - b).filter(d => d >= 0 && d <= maxDepth);

        const sigma = [];
        const u = [];
        const sigmaEff = [];

        depths.forEach(z => {
            // --- Total vertical stress ---
            let tot = 0;

            // Contribution from layer 1 (from 0 to min(z, z1))
            const zInL1 = Math.min(z, z1); // depth reached within layer 1
            if (zInL1 > 0) {
                // Above water table: dry unit weight
                const dryPart = Math.min(zInL1, hw);
                tot += dryPart * gamma1;
                // Below water table (but still in layer 1)
                const satPart = Math.max(0, zInL1 - hw);
                tot += satPart * gamma1Sat;
            }

            // Contribution from layer 2 (from z1 to z, only if z > z1)
            if (z > z1) {
                const zInL2 = z - z1;
                // Above water table (falda is inside layer 2, between z1 and z)
                const dryPart2 = Math.max(0, Math.min(z, hw) - z1);
                tot += dryPart2 * gamma1; // use gamma1 as approx dry γ for layer 2 (no separate slider)
                // Below water table in layer 2
                const satPart2 = Math.max(0, z - Math.max(z1, hw));
                tot += satPart2 * gamma2Sat;
            }

            // --- Pore pressure ---
            const pore = z > hw ? (z - hw) * gammaW : 0;

            sigma.push(parseFloat(tot.toFixed(2)));
            u.push(parseFloat(pore.toFixed(2)));
            sigmaEff.push(parseFloat((tot - pore).toFixed(2)));
        });

        // Sync soil log to chart plot area
        function syncSoilLogToChart() {
            if (!stressChart) return;
            const area = stressChart.chartArea;
            const container = document.getElementById('soil-log').parentElement;
            container.style.marginTop = area.top + 'px';
            container.style.height = (area.bottom - area.top) + 'px';
            // Also align the controls panel
            const controls = document.querySelector('#stressChart').closest('.module-content').querySelector('.controls-panel');
            if (controls) controls.style.marginTop = area.top + 'px';
        }

        // Draw Soil Log
        const soilLog = document.getElementById('soil-log');
        const waterTableLine = document.getElementById('water-table-line');
        if (soilLog && waterTableLine) {
            const z1Percent = Math.min((z1 / maxDepth) * 100, 100);
            const hwPercent = Math.min((hw / maxDepth) * 100, 100);
            
            soilLog.innerHTML = `
                <div class="soil-layer layer-1" style="top: 0; height: ${z1Percent}%;">Strato 1</div>
                <div class="soil-layer layer-2" style="top: ${z1Percent}%; height: ${100 - z1Percent}%;">Strato 2</div>
            `;
            waterTableLine.style.top = `${hwPercent}%`;
        }

        // Build {x, y} point arrays for each dataset
        const ptSigma    = depths.map((d, i) => ({ x: sigma[i],    y: d }));
        const ptU        = depths.map((d, i) => ({ x: u[i],        y: d }));
        const ptEff      = depths.map((d, i) => ({ x: sigmaEff[i], y: d }));

        // Reference lines: horizontal segment spanning full x range at z=hw and z=z1
        // Il massimo dell'asse x viene arrotondato al multiplo di 20 superiore: senza
        // arrotondamento, muovendo lo slider della falda il massimo cambiava di continuo
        // per variazioni minime, facendo apparire/sparire in modo intermittente l'ultima
        // etichetta dell'asse (es. "150") ogni volta che il valore ci oscillava vicino.
        const rawXMax = Math.max(...sigma) * 1.15 || 200;
        const xMax = Math.max(20, Math.ceil(rawXMax / 20) * 20);
        const lineHw = [{ x: 0, y: hw }, { x: xMax, y: hw }];
        const lineZ1 = [{ x: 0, y: z1 }, { x: xMax, y: z1 }];

        // Draw Chart
        if (stressChart) {
            stressChart.data.datasets[0].data = ptSigma;
            stressChart.data.datasets[1].data = ptU;
            stressChart.data.datasets[2].data = ptEff;
            stressChart.data.datasets[3].data = lineHw;
            stressChart.data.datasets[4].data = lineZ1;
            stressChart.options.scales.x.max = xMax;
            // 'none': aggiorna il grafico senza animare la transizione. Il triangolino
            // (disegnato dal plugin in base al valore corrente, non a quello animato)
            // altrimenti raggiungeva subito la posizione finale mentre la linea tratteggiata
            // "Falda" ci arrivava ancora animando, dando l'impressione che lo anticipasse.
            stressChart.update('none');
            syncSoilLogToChart();
        } else {
            stressChart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Totale (σ)',
                            data: ptSigma,
                            borderColor: '#e53e3e',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            tension: 0
                        },
                        {
                            label: 'Interstiziale (u)',
                            data: ptU,
                            borderColor: '#1E507F',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            tension: 0
                        },
                        {
                            label: 'Efficace (σ\')',
                            data: ptEff,
                            borderColor: '#38a169',
                            backgroundColor: 'rgba(56, 161, 105, 0.1)',
                            borderWidth: 3,
                            fill: { target: { value: 0 }, above: 'rgba(56, 161, 105, 0.1)' },
                            pointRadius: 0,
                            tension: 0
                        },
                        {
                            label: 'Falda (h_w)',
                            data: lineHw,
                            borderColor: '#1E507F',
                            backgroundColor: 'transparent',
                            borderWidth: 1.5,
                            borderDash: [3, 3],
                            pointRadius: 0,
                            tension: 0
                        },
                        {
                            label: 'Contatto strati (z₁)',
                            data: lineZ1,
                            borderColor: '#975a16',
                            backgroundColor: 'transparent',
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            tension: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        onComplete: () => syncSoilLogToChart()
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            reverse: true,   // 0 at top, increases downward
                            min: 0,
                            max: maxDepth,
                            title: { display: true, text: 'Profondità (m)' }
                        },
                        x: {
                            type: 'linear',
                            position: 'top',
                            min: 0,
                            max: xMax,
                            title: { display: true, text: 'Pressione / Tensione (kPa)' },
                            ticks: {
                                stepSize: 20,
                                // Numeri interi con il punto come separatore: evita che
                                // l'ultima etichetta compaia con la virgola (formattazione
                                // localizzata di Chart.js) o con decimali indesiderati.
                                callback: value => Math.round(value)
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { boxWidth: 20, padding: 14, font: { size: 12 } }
                        },
                        tooltip: {
                            mode: 'nearest',
                            intersect: false,
                            callbacks: {
                                title: items => `Profondità: ${items[0].parsed.y.toFixed(1)} m`,
                                label: item => `${item.dataset.label}: ${item.parsed.x.toFixed(1)} kPa`
                            }
                        }
                    }
                },
                plugins: [waterTableMarkerPlugin]
            });
        }
    }


    // Event listeners
    [hwInput, z1Input, gamma1Input, gamma1SatInput, gamma2SatInput].forEach(input => {
        input.addEventListener('input', updateChart);
    });

    // Initial render
    updateChart();
}

function initSettlementModule() {
    const dSigmaInput = document.getElementById('delta-sigma');
    const hClayInput = document.getElementById('h-clay');
    const ccInput = document.getElementById('cc');
    const e0Input = document.getElementById('e0');
    const sigma0Input = document.getElementById('sigma0');

    const valDSigma = document.getElementById('val-delta-sigma');
    const valHClay = document.getElementById('val-h-clay');
    const valCc = document.getElementById('val-cc');
    const valE0 = document.getElementById('val-e0');
    const valSigma0 = document.getElementById('val-sigma0');

    const resultSpan = document.getElementById('settlement-result');
    const soilLog = document.getElementById('settlement-soil-log');
    const deltaLabel = document.getElementById('settlement-delta-label');

    function updateSettlement() {
        const dSigma = parseFloat(dSigmaInput.value);
        const hClay = parseFloat(hClayInput.value);
        const cc = parseFloat(ccInput.value);
        const e0 = parseFloat(e0Input.value);
        const sigma0 = parseFloat(sigma0Input.value);

        valDSigma.textContent = dSigma;
        valHClay.textContent = hClay.toFixed(1);
        valCc.textContent = cc.toFixed(2);
        valE0.textContent = e0.toFixed(2);
        valSigma0.textContent = sigma0;

        // Formula: S = (Cc / (1 + e0)) * H * log10((sigma0' + dSigma) / sigma0')
        // S in meters
        const logPart = Math.log10((sigma0 + dSigma) / sigma0);
        let S_m = (cc / (1 + e0)) * hClay * logPart;
        
        // Convert to cm
        let S_cm = S_m * 100;
        
        resultSpan.textContent = S_cm.toFixed(1);

        // Visual feedback
        const totalDepth = 25; // 25m total depth for visual scale
        const topDepth = 5; // clay layer starts at 5m
        const clayThickness = hClay;
        let bottomThickness = totalDepth - topDepth - clayThickness;
        if (bottomThickness < 0) bottomThickness = 0; // fallback if slider is very large
        
        const topPercent = (topDepth / totalDepth) * 100;
        const clayPercent = (clayThickness / totalDepth) * 100;
        const bottomPercent = (bottomThickness / totalDepth) * 100;

        // Esagerazione visiva del cedimento: un cedimento reale di pochi centimetri
        // sarebbe impercettibile in scala 1:1, quindi lo amplifichiamo fino a "chiudere"
        // al massimo l'85% dello spessore disegnato dell'argilla (mai il 100%, altrimenti
        // lo strato sparirebbe del tutto). Il blocco di sabbia in superficie scende
        // visibilmente nello spazio lasciato libero, mentre lo strato di sabbia
        // inferiore resta fermo: è cosi' che si vede il cedimento in una prova reale.
        const closeFraction = Math.min(0.85, S_cm / 50);
        const gapPercent = clayPercent * closeFraction;

        if (soilLog) {
            soilLog.innerHTML = `
                <div class="settlement-gap" style="top: 0; height: ${gapPercent}%;">
                    <div class="settlement-original-line"></div>
                    <div class="settlement-gap-line"></div>
                </div>
                <div class="soil-layer" style="top: ${gapPercent}%; height: ${topPercent}%; background-color: #ecc94b; color: #744210;">Sabbia</div>
                <div class="soil-layer" style="top: ${topPercent + gapPercent}%; height: ${clayPercent - gapPercent}%; background-color: #975a16;">Argilla</div>
                <div class="soil-layer" style="top: ${topPercent + clayPercent}%; height: ${bottomPercent}%; background-color: #ecc94b; color: #744210;">Sabbia</div>
            `;
        }
        // Etichetta ΔH fuori dal contenitore degli strati (sopra il disegno): cosi' non
        // rischia mai di finire sovrapposta alla scritta "Sabbia" o "Argilla" dentro di esso.
        if (deltaLabel) deltaLabel.textContent = `ΔH = ${S_cm.toFixed(1)} cm`;
    }

    [dSigmaInput, hClayInput, ccInput, e0Input, sigma0Input].forEach(input => {
        input.addEventListener('input', updateSettlement);
    });

    updateSettlement();
}

function initDiffSettlementModule() {
    // Inputs Point A
    const aDSigma = document.getElementById('a-dsigma');
    const aH = document.getElementById('a-h');
    const aCc = document.getElementById('a-cc');
    const aE0 = document.getElementById('a-e0');
    const aSigma0 = document.getElementById('a-sigma0');

    // Inputs Point B
    const bDSigma = document.getElementById('b-dsigma');
    const bH = document.getElementById('b-h');
    const bCc = document.getElementById('b-cc');
    const bE0 = document.getElementById('b-e0');
    const bSigma0 = document.getElementById('b-sigma0');

    // Distance
    const distAB = document.getElementById('dist-ab');

    // Value displays Point A
    const valADSigma = document.getElementById('val-a-dsigma');
    const valAH = document.getElementById('val-a-h');
    const valACc = document.getElementById('val-a-cc');
    const valAE0 = document.getElementById('val-a-e0');
    const valASigma0 = document.getElementById('val-a-sigma0');

    // Value displays Point B
    const valBDSigma = document.getElementById('val-b-dsigma');
    const valBH = document.getElementById('val-b-h');
    const valBCc = document.getElementById('val-b-cc');
    const valBE0 = document.getElementById('val-b-e0');
    const valBSigma0 = document.getElementById('val-b-sigma0');

    const valDistAB = document.getElementById('val-dist-ab');

    // Outputs
    const resA = document.getElementById('res-a');
    const resB = document.getElementById('res-b');
    const resDiff = document.getElementById('res-diff');
    const resAngular = document.getElementById('res-angular');

    const canvas = document.getElementById('diffCanvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    function calcSettlement(dSigma, h, cc, e0, sigma0) {
        const logPart = Math.log10((sigma0 + dSigma) / sigma0);
        const S_m = (cc / (1 + e0)) * h * logPart;
        return S_m * 100; // cm
    }

    function updateDiffSettlement() {
        const dSigA = parseFloat(aDSigma.value);
        const hA = parseFloat(aH.value);
        const ccA = parseFloat(aCc.value);
        const e0A = parseFloat(aE0.value);
        const sig0A = parseFloat(aSigma0.value);

        const dSigB = parseFloat(bDSigma.value);
        const hB = parseFloat(bH.value);
        const ccB = parseFloat(bCc.value);
        const e0B = parseFloat(bE0.value);
        const sig0B = parseFloat(bSigma0.value);

        const L = parseFloat(distAB.value);

        // Update labels
        valADSigma.textContent = dSigA;
        valAH.textContent = hA.toFixed(1);
        valACc.textContent = ccA.toFixed(2);
        valAE0.textContent = e0A.toFixed(2);
        valASigma0.textContent = sig0A;

        valBDSigma.textContent = dSigB;
        valBH.textContent = hB.toFixed(1);
        valBCc.textContent = ccB.toFixed(2);
        valBE0.textContent = e0B.toFixed(2);
        valBSigma0.textContent = sig0B;

        valDistAB.textContent = L;

        // Calculations
        const sA_cm = calcSettlement(dSigA, hA, ccA, e0A, sig0A);
        const sB_cm = calcSettlement(dSigB, hB, ccB, e0B, sig0B);
        const diff_cm = Math.abs(sA_cm - sB_cm);
        
        // Angular distortion delta / L (dimensionless), expressed x10^-3
        // delta_cm / (L_m * 100) = delta / (L * 100)
        // in 10^-3: (delta_cm / (L_m * 100)) * 1000 = delta_cm / (L_m * 0.1) = 10 * delta_cm / L_m
        const angularDistortion103 = (diff_cm * 10) / L;

        resA.textContent = sA_cm.toFixed(1);
        resB.textContent = sB_cm.toFixed(1);
        resDiff.textContent = diff_cm.toFixed(1);
        resAngular.textContent = angularDistortion103.toFixed(2);

        // Render Canvas
        if (ctx && canvas) {
            drawDiffCanvas(sA_cm, sB_cm, L);
        }
    }

    // Rettangolo con angoli arrotondati (i vecchi plinti erano disegnati con ctx.rect,
    // qui usiamo un percorso con arcTo cosi' funziona anche senza CanvasRenderingContext2D.roundRect)
    function roundedRectPath(context, x, y, w, h, r) {
        context.beginPath();
        context.moveTo(x + r, y);
        context.arcTo(x + w, y, x + w, y + h, r);
        context.arcTo(x + w, y + h, x, y + h, r);
        context.arcTo(x, y + h, x, y, r);
        context.arcTo(x, y, x + w, y, r);
        context.closePath();
    }

    // Tratteggio diagonale "da sezione" dentro un rettangolo, tipico dei plinti/fondazioni
    // nei disegni tecnici: da' subito l'idea di un blocco di calcestruzzo, non solo un rettangolo pieno.
    function drawHatch(context, x, y, w, h, color) {
        context.save();
        roundedRectPath(context, x, y, w, h, 4);
        context.clip();
        context.strokeStyle = color;
        context.lineWidth = 1;
        const step = 7;
        for (let i = -h; i < w + h; i += step) {
            context.beginPath();
            context.moveTo(x + i, y + h);
            context.lineTo(x + i + h, y);
            context.stroke();
        }
        context.restore();
    }

    function drawDiffCanvas(sA, sB, L) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const marginX = 85;
        const groundY = 90;
        const maxVisualS = 100; // scala massima del cedimento in pixel
        const padW = 58, padH = 24; // dimensioni del plinto di fondazione

        // Scala i cedimenti in pixel
        const pyA = groundY + Math.min((sA / 50) * maxVisualS, maxVisualS);
        const pyB = groundY + Math.min((sB / 50) * maxVisualS, maxVisualS);

        const xA = marginX;
        const xB = w - marginX;

        // Sfondo: terreno con una leggera sfumatura verticale
        const soilGradient = ctx.createLinearGradient(0, groundY, 0, h);
        soilGradient.addColorStop(0, '#f1f5f9');
        soilGradient.addColorStop(1, '#e2e8f0');
        ctx.fillStyle = soilGradient;
        ctx.fillRect(0, groundY, w, h - groundY);

        // Piano campagna originale (tratteggiato, fisso)
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xA - 35, groundY);
        ctx.lineTo(xB + 35, groundY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px Outfit, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('piano campagna iniziale', xA - 35, groundY - 6);

        // Superficie deformata (zona fra il piano originale e la trave di fondazione)
        ctx.fillStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.beginPath();
        ctx.moveTo(xA, groundY);
        ctx.lineTo(xB, groundY);
        ctx.lineTo(xB, pyB);
        ctx.lineTo(xA, pyA);
        ctx.closePath();
        ctx.fill();

        // Trave di collegamento fra i due plinti
        ctx.beginPath();
        ctx.moveTo(xA, pyA - padH / 2);
        ctx.lineTo(xB, pyB - padH / 2);
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1E507F';
        ctx.stroke();

        // Plinti di fondazione: blocco pieno + tratteggio "da sezione" + bordo netto
        [[xA, pyA], [xB, pyB]].forEach(([x, y]) => {
            const bx = x - padW / 2, by = y - padH;
            roundedRectPath(ctx, bx, by, padW, padH, 4);
            ctx.fillStyle = '#e2e8f0';
            ctx.fill();
            drawHatch(ctx, bx, by, padW, padH, 'rgba(71, 85, 105, 0.35)');
            roundedRectPath(ctx, bx, by, padW, padH, 4);
            ctx.lineWidth = 2.25;
            ctx.strokeStyle = '#334155';
            ctx.stroke();
        });

        // Punti A e B (al centro della base del plinto, sulla trave)
        ctx.fillStyle = '#1E507F';
        ctx.beginPath();
        ctx.arc(xA, pyA - padH / 2, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#b7791f';
        ctx.beginPath();
        ctx.arc(xB, pyB - padH / 2, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Etichette A e B sopra i plinti
        ctx.font = 'bold 16px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#1E507F';
        ctx.fillText('A', xA, pyA - padH - 12);
        ctx.fillStyle = '#b7791f';
        ctx.fillText('B', xB, pyB - padH - 12);
        ctx.textAlign = 'left';

        // Frecce quotate che mostrano il cedimento di A e di B
        drawArrow(ctx, xA - 45, groundY, xA - 45, pyA, '#1E507F');
        drawDimLabel(ctx, `${sA.toFixed(1)} cm`, xA - 45, (groundY + pyA) / 2, '#1E507F');

        drawArrow(ctx, xB + 45, groundY, xB + 45, pyB, '#b7791f');
        drawDimLabel(ctx, `${sB.toFixed(1)} cm`, xB + 45, (groundY + pyB) / 2, '#b7791f');

        // Quota della distanza L, in alto
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xA, 30);
        ctx.lineTo(xB, 30);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '12px Outfit, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
        const lLabelW = ctx.measureText(`L = ${L} m`).width + 12;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect((xA + xB) / 2 - lLabelW / 2, 18, lLabelW, 16);
        ctx.fillStyle = '#475569';
        ctx.fillText(`L = ${L} m`, (xA + xB) / 2, 30);
        ctx.textAlign = 'left';
    }

    // Etichetta con sfondo bianco arrotondato, per restare leggibile sopra il terreno
    // sfumato o le linee tratteggiate qualunque sia il cedimento visualizzato
    function drawDimLabel(context, text, cx, cy, color) {
        context.font = '12px Outfit, sans-serif';
        context.textAlign = 'center';
        const padX = 6, padY = 3;
        const textW = context.measureText(text).width;
        const boxW = textW + padX * 2, boxH = 16 + padY;
        roundedRectPath(context, cx - boxW / 2, cy - boxH / 2, boxW, boxH, 4);
        context.fillStyle = '#ffffff';
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = color;
        context.stroke();
        context.fillStyle = color;
        context.fillText(text, cx, cy + 4);
        context.textAlign = 'left';
    }

    function drawArrow(context, fromx, fromy, tox, toy, color) {
        if (Math.abs(toy - fromy) < 4) return; // evita di disegnare frecce troppo corte
        const headlen = 8;
        const dx = tox - fromx;
        const dy = toy - fromy;
        const angle = Math.atan2(dy, dx);
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(fromx, fromy);
        context.lineTo(tox, toy);
        context.stroke();
        context.beginPath();
        context.moveTo(tox, toy);
        context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
        context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
        context.closePath();
        context.fill();
    }

    // Event listeners
    const inputs = [
        aDSigma, aH, aCc, aE0, aSigma0,
        bDSigma, bH, bCc, bE0, bSigma0,
        distAB
    ];

    inputs.forEach(input => {
        if (input) input.addEventListener('input', updateDiffSettlement);
    });

    updateDiffSettlement();
}

// ============================================================
// Modulo 8: Cedimenti delle Fondazioni — sotto-schede (Abaco di Fadum /
// Cedimento Differenziale), stesso pattern di initEdoSubTabs.
// ============================================================
function initFondSubTabs() {
    const buttons = document.querySelectorAll('.fond-subtab-btn');
    const panels = document.querySelectorAll('[data-fond-subpanel]');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => {
                const active = b === btn;
                b.classList.toggle('active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            const name = btn.dataset.fondSubtab;
            panels.forEach(p => { p.hidden = p.dataset.fondSubpanel !== name; });
        });
    });
}

// Fattore di influenza di Newmark (1935) per l'incremento di tensione verticale
// sotto l'angolo di un'area rettangolare flessibile uniformemente caricata, in
// funzione di m = B/z e n = L/z (integrazione della soluzione di Boussinesq
// sull'area rettangolare). E' la stessa soluzione alla base dell'abaco di
// Fadum: qui viene calcolata in forma chiusa anziché letta graficamente, cosa
// che permette di individuare Is con precisione per qualunque m,n anziché solo
// sulle curve discrete effettivamente stampate sull'abaco.
// Nota sul termine arctan: la formula classica richiede di sommare π quando
// (m²+n²+1) < m²n² per restare nel quadrante corretto; usare Math.atan2 con
// numeratore sempre positivo (2mn·√A) applica automaticamente questa
// correzione, senza bisogno di un if esplicito.
function newmarkIs(m, n) {
    if (!Number.isFinite(m) || !Number.isFinite(n) || m <= 0 || n <= 0) return 0;
    const m2 = m * m, n2 = n * n;
    const A = m2 + n2 + 1;
    const sqrtA = Math.sqrt(A);
    const term1 = (2 * m * n * sqrtA / (A + m2 * n2)) * ((A + 1) / A);
    const arctanTerm = Math.atan2(2 * m * n * sqrtA, A - m2 * n2);
    return (term1 + arctanTerm) / (4 * Math.PI);
}

// ============================================================
// Sotto-modulo A del modulo 8: Abaco di Fadum (fattore di influenza Is)
// ============================================================
function initFadumTool() {
    const bInput = document.getElementById('fadum-b');
    const lInput = document.getElementById('fadum-l');
    const zInput = document.getElementById('fadum-z');
    const valB = document.getElementById('val-fadum-b');
    const valL = document.getElementById('val-fadum-l');
    const valZ = document.getElementById('val-fadum-z');
    const mOut = document.getElementById('fadum-m');
    const nOut = document.getElementById('fadum-n');
    const isOut = document.getElementById('fadum-is');

    const canvas = document.getElementById('fadumChart');
    const ctx = canvas ? canvas.getContext('2d') : null;
    let chart = null;

    // Estensione dell'abaco: m da 0.05 a 10 in scala log (copre ampiamente il
    // range di m,n ottenibile dagli slider B/L/Z), Is da 0 a 0.28 (l'asintoto
    // teorico per m,n grandi è 0.25).
    const X_MIN = 0.05, X_MAX = 10, Y_MAX = 0.28;

    // Famiglia di curve di riferimento a n costante, gli stessi valori di n
    // tipicamente stampati sull'abaco di Fadum nei testi di geotecnica.
    const REF_N = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 3.0, 5.0, 10.0];

    const N_SAMPLES = 60;
    const mSamples = [];
    for (let i = 0; i <= N_SAMPLES; i++) {
        const t = i / N_SAMPLES;
        mSamples.push(X_MIN * Math.pow(X_MAX / X_MIN, t)); // campionamento in scala log
    }
    function curveFor(n) {
        return mSamples.map(m => ({ x: m, y: newmarkIs(m, n) }));
    }

    // Le curve di riferimento non dipendono dagli input (B, L, Z): si
    // calcolano una sola volta, non ad ogni recompute().
    const refCurvesData = REF_N.map(curveFor);

    function recompute() {
        const B = parseFloat(bInput.value);
        const L = parseFloat(lInput.value);
        const Z = parseFloat(zInput.value);

        valB.textContent = B.toFixed(1);
        valL.textContent = L.toFixed(1);
        valZ.textContent = Z.toFixed(1);

        // Punto significativo al centro della fondazione: metodo dei quattro
        // rettangoli B/2 x L/2 con un vertice comune nel centro, da cui
        // m = (B/2)/Z e n = (L/2)/Z (anziché B/Z, L/Z che varrebbero per il
        // punto sotto l'angolo dell'intera fondazione B x L).
        const m = (B / 2) / Z;
        const n = (L / 2) / Z;
        const Is = newmarkIs(m, n);

        mOut.textContent = m.toFixed(3);
        nOut.textContent = n.toFixed(3);
        isOut.textContent = Number.isFinite(Is) ? Is.toFixed(4) : '—';

        const currentCurveData = curveFor(n);
        const guideData = [
            { x: X_MIN, y: Is },
            { x: m, y: Is },
            { x: m, y: 0 }
        ];
        const pointData = [{ x: m, y: Is }];

        if (chart) {
            chart.data.datasets[REF_N.length + 1].data = currentCurveData;
            chart.data.datasets[REF_N.length + 2].data = guideData;
            chart.data.datasets[REF_N.length + 3].data = pointData;
            chart.update('none');
            return;
        }

        if (!ctx) return;

        const refDatasets = REF_N.map((nv, i) => ({
            label: `n = ${nv.toFixed(1)}`,
            data: refCurvesData[i],
            borderColor: '#cbd5e1',
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.15,
            showInLegend: false
        }));

        chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    ...refDatasets,
                    { label: 'Curve di riferimento (n = cost.)', data: [], borderColor: '#cbd5e1', backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0 },
                    { label: 'Curva per il valore di n corrente', data: currentCurveData, borderColor: '#1E507F', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.15 },
                    { label: "Lettura sull'abaco", data: guideData, borderColor: '#94a3b8', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, tension: 0, showInLegend: false },
                    { label: 'Punto (m, Is)', data: pointData, borderColor: '#38a169', backgroundColor: '#38a169', pointRadius: 7, pointStyle: 'rectRot', showLine: false }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { type: 'logarithmic', min: X_MIN, max: X_MAX, title: { display: true, text: 'm (scala log)' } },
                    y: { type: 'linear', min: 0, max: Y_MAX, title: { display: true, text: 'Fattore di influenza Is' } }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 14, font: { size: 10 },
                            filter: (item, data) => data.datasets[item.datasetIndex].showInLegend !== false
                        }
                    },
                    tooltip: {
                        filter: item => item.dataset.showInLegend !== false,
                        callbacks: {
                            title: items => `m = ${parseFloat(items[0].parsed.x.toFixed(3))}`,
                            label: item => `${item.dataset.label}: Is = ${item.parsed.y.toFixed(4)}`
                        }
                    }
                }
            }
        });
    }

    [bInput, lInput, zInput].forEach(el => {
        if (el) el.addEventListener('input', recompute);
    });

    recompute();
}

// Wrapper del modulo 8 (Cedimenti delle Fondazioni): sotto-schede + i due
// strumenti (Abaco di Fadum, Cedimento Differenziale — quest'ultimo
// invariato, prima era un modulo standalone).
function initFondazioniModule() {
    initFondSubTabs();
    initFadumTool();
    initDiffSettlementModule();
}

/* ============================================================
   Modulo 4: Granulometria e Classificazione
   ============================================================ */

function initGranulometriaModule() {

    // --- Dati di riferimento per la denominazione AGI (1977) ---
    // L'aggettivo della frazione secondaria concorda per genere con il
    // sostantivo della frazione dominante (es. "sabbia limosa", non "sabbia limoso").
    const FRACTION_META = {
        ghiaia:  { label: 'Ghiaia',  gender: 'f', adjM: 'ghiaioso',  adjF: 'ghiaiosa'  },
        sabbia:  { label: 'Sabbia',  gender: 'f', adjM: 'sabbioso',  adjF: 'sabbiosa'  },
        limo:    { label: 'Limo',    gender: 'm', adjM: 'limoso',    adjF: 'limosa'    },
        argilla: { label: 'Argilla', gender: 'f', adjM: 'argilloso', adjF: 'argillosa' }
    };

    // Punto di partenza: serie di setacci UNI/CNR (63, 20, 6.3, 2, 0.6, 0.212,
    // 0.063 mm) con un esempio di curva granulometrica, seguita dai diametri
    // tipici della fase di sedimentazione (0.02, 0.006, 0.002 mm — percentuali
    // da inserire, lasciate vuote). Sono valori di esempio: ogni riga resta
    // modificabile e se ne possono aggiungere altre con "+ Aggiungi punto".
    // "group" serve solo a raggruppare visivamente le righe in tabella.
    const GROUP_LABELS = { setacciatura: 'Setacciatura', sedimentazione: 'Sedimentazione' };
    let granPoints = [
        { d: 63,    p: 100, group: 'setacciatura' },
        { d: 20,    p: 64,  group: 'setacciatura' },
        { d: 6.3,   p: 39,  group: 'setacciatura' },
        { d: 2,     p: 24,  group: 'setacciatura' },
        { d: 0.6,   p: 12,  group: 'setacciatura' },
        { d: 0.212, p: 5,   group: 'setacciatura' },
        { d: 0.063, p: 0,   group: 'setacciatura' },
        { d: 0.02,  p: '',  group: 'sedimentazione' },
        { d: 0.006, p: '',  group: 'sedimentazione' },
        { d: 0.002, p: '',  group: 'sedimentazione' }
    ];

    const X_AXIS_MIN = 0.0005;
    const X_AXIS_MAX = 100;

    // Metadati dei diametri caratteristici D10/D30/D60: colore, percentuale di passante
    // di riferimento e formula in cui il parametro viene utilizzato (mostrata nel tooltip).
    const D_META = {
        10: { key: 10, color: '#38a169', percent: 10, formula: 'Usato in Cu = D60 / D10' },
        30: { key: 30, color: '#dd6b20', percent: 30, formula: 'Usato in Cc = D30² / (D60 · D10)' },
        60: { key: 60, color: '#805ad5', percent: 60, formula: 'Usato in Cu = D60 / D10 e Cc = D30² / (D60 · D10)' }
    };
    // Indice dei dataset "costruzione" (linee a squadra) nel grafico granulometrico
    const D_DATASET_INDEX = { 10: 5, 30: 6, 60: 7 };
    const activeDValues = { 10: false, 30: false, 60: false };

    const tbody = document.getElementById('gran-table-body');
    const addRowBtn = document.getElementById('gran-add-row');
    const wlInput = document.getElementById('gran-wl');
    const wpInput = document.getElementById('gran-wp');
    const organicInput = document.getElementById('gran-organic');
    const fractionsEl = document.getElementById('gran-fractions');
    const coeffsEl = document.getElementById('gran-coeffs');
    const agiNameEl = document.getElementById('gran-agi-name');
    const uscsEl = document.getElementById('gran-uscs');
    const uscsDescEl = document.getElementById('gran-uscs-desc');
    const dButtons = document.querySelectorAll('.gran-d-btn');
    const dInfoEl = document.getElementById('gran-d-info');

    wlInput.value = 26;
    wpInput.value = 17;

    let granChart = null;
    let casagrandeChart = null;

    function fmt(x, decimals) {
        if (x === null || x === undefined || !Number.isFinite(x)) return '—';
        return x.toFixed(decimals);
    }

    // Valore + unità di misura su riga separata (evita che l'unità vada a capo
    // in modo scomposto quando la card è stretta); l'unità non compare se il
    // valore non è disponibile ("—").
    function fmtUnit(x, decimals, unit) {
        const text = fmt(x, decimals);
        if (text === '—') return text;
        return `${text}<span class="gran-fraction-unit">${unit}</span>`;
    }

    // --- Interpolazione log-lineare sulla curva granulometrica ---
    // points: array {d, p} ordinato per d crescente
    function passingAt(points, targetD) {
        if (points.length === 0) return null;
        if (targetD <= points[0].d) return points[0].p;
        if (targetD >= points[points.length - 1].d) return points[points.length - 1].p;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i], p1 = points[i + 1];
            if (targetD >= p0.d && targetD <= p1.d) {
                if (p1.d === p0.d) return (p0.p + p1.p) / 2;
                const logD0 = Math.log10(p0.d), logD1 = Math.log10(p1.d), logT = Math.log10(targetD);
                const frac = (logT - logD0) / (logD1 - logD0);
                return p0.p + frac * (p1.p - p0.p);
            }
        }
        return null;
    }

    function diameterAtPassing(points, targetP) {
        if (points.length === 0) return null;
        if (targetP === points[0].p) return points[0].d;
        if (targetP === points[points.length - 1].p) return points[points.length - 1].d;
        if (targetP < points[0].p || targetP > points[points.length - 1].p) return null; // fuori dal range misurato
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i], p1 = points[i + 1];
            if (targetP >= p0.p && targetP <= p1.p) {
                if (p1.p === p0.p) return Math.sqrt(p0.d * p1.d);
                const logD0 = Math.log10(p0.d), logD1 = Math.log10(p1.d);
                const frac = (targetP - p0.p) / (p1.p - p0.p);
                return Math.pow(10, logD0 + frac * (logD1 - logD0));
            }
        }
        return null;
    }

    // --- Denominazione AGI (1977) ---
    function agiName(GF, SF, MF, CF) {
        const fr = [
            { key: 'ghiaia', val: GF },
            { key: 'sabbia', val: SF },
            { key: 'limo', val: MF },
            { key: 'argilla', val: CF }
        ].sort((a, b) => b.val - a.val);

        const dominant = fr[0], secondary = fr[1];
        if (!(dominant.val > 0)) return '—';
        const domMeta = FRACTION_META[dominant.key];
        let name = domMeta.label;

        if (secondary.val >= 25) {
            name += ' con ' + FRACTION_META[secondary.key].label.toLowerCase();
        } else if (secondary.val >= 15) {
            name += ' ' + (domMeta.gender === 'f' ? FRACTION_META[secondary.key].adjF : FRACTION_META[secondary.key].adjM);
        } else if (secondary.val >= 5) {
            name += ' debolmente ' + (domMeta.gender === 'f' ? FRACTION_META[secondary.key].adjF : FRACTION_META[secondary.key].adjM);
        }
        return name;
    }

    // --- Classificazione USCS ---
    // Restituisce 'M', 'C' oppure 'DUAL' (zona di transizione 4<=Ip<=7 vicino alla retta A)
    function classifyFineType(Ip, wL) {
        const aLine = 0.73 * (wL - 20);
        if (Ip < 4) return 'M';
        if (Ip > 7) return Ip >= aLine ? 'C' : 'M';
        return 'DUAL';
    }

    function classifyUSCS(GF, SF, MF, CF, P2, F200, Cu, Cc, Ip, wL, organic) {
        if (F200 === null) {
            return { symbol: '—', desc: 'Servono più punti della curva per stimare il passante a 0.075 mm (setaccio n.200).' };
        }

        const wellGradedInfo = (coarse) => {
            if (Cu === null || Cc === null) return null;
            const cuThreshold = coarse === 'G' ? 4 : 6;
            return Cu >= cuThreshold && Cc >= 1 && Cc <= 3;
        };

        if (F200 < 50) {
            // --- Terre a grana grossa ---
            const gravelFrac = 100 - P2;
            const sandFrac = Math.max(0, P2 - F200);
            const coarse = gravelFrac >= sandFrac ? 'G' : 'S';
            const coarseLabel = coarse === 'G' ? 'ghiaia' : 'sabbia';

            if (F200 < 5) {
                const wellGraded = wellGradedInfo(coarse);
                if (wellGraded === null) {
                    return { symbol: coarse + 'W/P', desc: 'Servono almeno 3 punti (D10, D30, D60) per determinare il grado di assortimento.' };
                }
                const symbol = coarse + (wellGraded ? 'W' : 'P');
                return { symbol, desc: (coarseLabel.charAt(0).toUpperCase() + coarseLabel.slice(1)) + ' pulita (fini < 5%), ' + (wellGraded ? 'ben assortita' : 'poco assortita') + '.' };
            }

            if (Ip === null || wL === null) {
                return { symbol: coarse + 'M/C', desc: 'Inserisci wL e wP per determinare se la frazione fine è limosa o argillosa.' };
            }
            const fineType = classifyFineType(Ip, wL);

            if (F200 <= 12) {
                const wellGraded = wellGradedInfo(coarse);
                const gradSymbol = coarse + (wellGraded === null ? 'P' : (wellGraded ? 'W' : 'P'));
                const fineSuffix = fineType === 'DUAL' ? 'M-' + coarse + 'C' : coarse + fineType;
                return {
                    symbol: gradSymbol + '-' + fineSuffix,
                    desc: 'Simbolo doppio (fini 5–12%): ' + coarseLabel + ' con frazione fine ' + (fineType === 'C' ? 'argillosa' : fineType === 'M' ? 'limosa' : 'al limite fra limosa e argillosa') + '.'
                };
            }

            // F200 > 12%
            const fine = fineType === 'DUAL' ? 'C' : fineType;
            return {
                symbol: coarse + fine,
                desc: (coarseLabel.charAt(0).toUpperCase() + coarseLabel.slice(1)) + ' con elevata frazione fine ' + (fine === 'C' ? 'argillosa' : 'limosa') + (fineType === 'DUAL' ? ' (al limite fra limo e argilla, qui approssimata a C)' : '') + '.'
            };
        }

        // --- Terre a grana fine (F200 >= 50%) ---
        const family = (wL !== null && wL >= 50) ? 'H' : 'L';
        if (Ip === null || wL === null) {
            return { symbol: '—' + family, desc: 'Inserisci wL e wP per completare la classificazione (ML/CL/OL oppure MH/CH/OH).' };
        }
        const aLine = 0.73 * (wL - 20);

        if (organic) {
            const symbol = 'O' + family;
            return { symbol, desc: 'Limo/argilla organica a ' + (family === 'H' ? 'alta' : 'bassa') + ' plasticità (componente organica dichiarata dall\'utente).' };
        }
        if (Ip >= 4 && Ip <= 7 && Ip < aLine + 1e-9 && Ip > aLine - 3) {
            // zona di transizione classica solo per bassa plasticità
            if (family === 'L') {
                return { symbol: 'CL-ML', desc: 'Zona di transizione fra limo e argilla a bassa plasticità (4 ≤ Ip ≤ 7, in prossimità della retta A).' };
            }
        }
        const type = classifyFineType(Ip, wL) === 'C' ? 'C' : 'M';
        const symbol = type + family;
        const descMap = {
            ML: 'Limo inorganico a bassa plasticità.',
            CL: 'Argilla inorganica a bassa plasticità.',
            MH: 'Limo inorganico ad alta plasticità (anche limi diatomacei).',
            CH: 'Argilla inorganica ad alta plasticità.'
        };
        return { symbol, desc: descMap[symbol] || '' };
    }

    // --- Tabella dati: rendering e gestione righe ---
    function renderGranTable() {
        tbody.innerHTML = '';
        let lastGroup = null;
        granPoints.forEach((pt, idx) => {
            if (pt.group && pt.group !== lastGroup) {
                const trHead = document.createElement('tr');
                trHead.className = 'gran-group-divider';
                const tdHead = document.createElement('td');
                tdHead.colSpan = 3;
                tdHead.textContent = GROUP_LABELS[pt.group] || pt.group;
                trHead.appendChild(tdHead);
                tbody.appendChild(trHead);
                lastGroup = pt.group;
            }
            const tr = document.createElement('tr');

            const tdD = document.createElement('td');
            const inputD = document.createElement('input');
            inputD.type = 'number';
            inputD.step = 'any';
            inputD.min = '0';
            inputD.value = pt.d;
            inputD.addEventListener('input', () => {
                granPoints[idx].d = parseFloat(inputD.value);
                recompute();
            });
            tdD.appendChild(inputD);

            const tdP = document.createElement('td');
            const inputP = document.createElement('input');
            inputP.type = 'number';
            inputP.step = 'any';
            inputP.min = '0';
            inputP.max = '100';
            inputP.value = pt.p;
            inputP.addEventListener('input', () => {
                granPoints[idx].p = parseFloat(inputP.value);
                recompute();
            });
            tdP.appendChild(inputP);

            const tdDel = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'gran-remove-row';
            delBtn.innerHTML = '&times;';
            delBtn.title = 'Rimuovi punto';
            delBtn.addEventListener('click', () => {
                granPoints.splice(idx, 1);
                renderGranTable();
                recompute();
            });
            tdDel.appendChild(delBtn);

            tr.appendChild(tdD);
            tr.appendChild(tdP);
            tr.appendChild(tdDel);
            tbody.appendChild(tr);
        });
    }

    addRowBtn.addEventListener('click', () => {
        const inheritedGroup = granPoints.length ? granPoints[granPoints.length - 1].group : 'setacciatura';
        granPoints.push({ d: 1, p: 50, group: inheritedGroup || 'setacciatura' });
        renderGranTable();
        recompute();
    });

    [wlInput, wpInput, organicInput].forEach(el => {
        el.addEventListener('input', recompute);
    });

    // --- Tasti D10 / D30 / D60: evidenziano il punto sulla curva con due linee a squadra ---
    dButtons.forEach(btn => {
        const key = parseInt(btn.dataset.d, 10);
        btn.style.setProperty('--d-color', D_META[key].color);
        btn.addEventListener('click', () => {
            activeDValues[key] = !activeDValues[key];
            btn.classList.toggle('active', activeDValues[key]);
            recompute();
        });
    });

    // --- Plugin per etichette di zona sul diagramma di Casagrande ---
    const casagrandeLabelsPlugin = {
        id: 'casagrandeLabels',
        afterDatasetsDraw(chart) {
            const { ctx, scales } = chart;
            const labels = [
                { text: 'ML / OL', x: 32, y: 3 },
                { text: 'CL', x: 40, y: 18 },
                { text: 'CL-ML', x: 24, y: 5.5 },
                { text: 'MH / OH', x: 80, y: 14 },
                { text: 'CH', x: 78, y: 40 },
                { text: 'retta A', x: 82, y: 0.73 * (82 - 20) + 2 },
                { text: 'retta U', x: 60, y: 0.9 * (60 - 8) + 2 }
            ];
            ctx.save();
            ctx.font = '11px Outfit, sans-serif';
            ctx.fillStyle = '#718096';
            labels.forEach(l => {
                const px = scales.x.getPixelForValue(l.x);
                const py = scales.y.getPixelForValue(l.y);
                if (px >= scales.x.left && px <= scales.x.right && py >= scales.y.top && py <= scales.y.bottom) {
                    ctx.fillText(l.text, px, py);
                }
            });
            ctx.restore();
        }
    };

    function recompute() {
        const validRaw = granPoints
            .map(pt => ({ d: parseFloat(pt.d), p: parseFloat(pt.p) }))
            .filter(pt => Number.isFinite(pt.d) && pt.d > 0 && Number.isFinite(pt.p) && pt.p >= 0 && pt.p <= 100)
            .sort((a, b) => a.d - b.d);

        // Rimuove duplicati sullo stesso diametro (tiene l'ultimo inserito)
        const points = [];
        validRaw.forEach(pt => {
            if (points.length && Math.abs(points[points.length - 1].d - pt.d) < 1e-9) {
                points[points.length - 1] = pt;
            } else {
                points.push(pt);
            }
        });

        const wL = wlInput.value !== '' ? parseFloat(wlInput.value) : null;
        const wP = wpInput.value !== '' ? parseFloat(wpInput.value) : null;
        const Ip = (Number.isFinite(wL) && Number.isFinite(wP)) ? (wL - wP) : null;

        let GF = null, SF = null, MF = null, CF = null, D10 = null, D30 = null, D60 = null, Cu = null, Cc = null, P2 = null, F200 = null;

        if (points.length >= 2) {
            P2 = passingAt(points, 2);
            const P006 = passingAt(points, 0.06);
            const P0002 = passingAt(points, 0.002);
            F200 = passingAt(points, 0.075);

            GF = Math.max(0, 100 - P2);
            SF = Math.max(0, P2 - P006);
            MF = Math.max(0, P006 - P0002);
            CF = Math.max(0, P0002);

            D10 = diameterAtPassing(points, 10);
            D30 = diameterAtPassing(points, 30);
            D60 = diameterAtPassing(points, 60);
            Cu = (D10 && D60) ? D60 / D10 : null;
            Cc = (D10 && D30 && D60) ? (D30 * D30) / (D60 * D10) : null;
        }

        // --- Aggiorna pannello frazioni ---
        if (GF !== null) {
            fractionsEl.innerHTML = `
                <div><span class="gran-fraction-label">Ghiaia (&gt;2mm)</span><span class="gran-fraction-value">${fmtUnit(GF, 1, '%')}</span></div>
                <div><span class="gran-fraction-label">Sabbia (0.06-2mm)</span><span class="gran-fraction-value">${fmtUnit(SF, 1, '%')}</span></div>
                <div><span class="gran-fraction-label">Limo (0.002-0.06mm)</span><span class="gran-fraction-value">${fmtUnit(MF, 1, '%')}</span></div>
                <div><span class="gran-fraction-label">Argilla (&lt;0.002mm)</span><span class="gran-fraction-value">${fmtUnit(CF, 1, '%')}</span></div>
            `;
        } else {
            fractionsEl.innerHTML = `<div class="gran-small-note">Aggiungi almeno due punti alla curva granulometrica.</div>`;
        }

        coeffsEl.innerHTML = `
            <div><span class="gran-fraction-label">D<sub>10</sub></span><span class="gran-fraction-value">${fmtUnit(D10, 3, 'mm')}</span></div>
            <div><span class="gran-fraction-label">D<sub>30</sub></span><span class="gran-fraction-value">${fmtUnit(D30, 3, 'mm')}</span></div>
            <div><span class="gran-fraction-label">D<sub>60</sub></span><span class="gran-fraction-value">${fmtUnit(D60, 3, 'mm')}</span></div>
            <div><span class="gran-fraction-label">C<sub>U</sub></span><span class="gran-fraction-value">${fmt(Cu, 2)}</span></div>
            <div><span class="gran-fraction-label">C<sub>C</sub></span><span class="gran-fraction-value">${fmt(Cc, 2)}</span></div>
            <div><span class="gran-fraction-label">I<sub>P</sub></span><span class="gran-fraction-value">${Ip !== null ? fmtUnit(Ip, 1, '%') : '—'}</span></div>
        `;

        agiNameEl.textContent = (GF !== null) ? agiName(GF, SF, MF, CF) : '—';

        const uscsResult = (GF !== null)
            ? classifyUSCS(GF, SF, MF, CF, P2, F200, Cu, Cc, Ip, wL, organicInput.checked)
            : { symbol: '—', desc: 'Aggiungi almeno due punti alla curva granulometrica.' };
        uscsEl.textContent = uscsResult.symbol;
        uscsDescEl.textContent = uscsResult.desc;

        updateGranChart(points, { 10: D10, 30: D30, 60: D60 });
        updateCasagrandeChart(Ip, wL);
    }

    function refLine(x) {
        return [{ x, y: 0 }, { x, y: 100 }];
    }

    // Costruisce la "linea a squadra" (verticale + orizzontale) che marca il punto
    // (D_n, n%) sulla curva, più il testo da mostrare nel tooltip e nella scheda info.
    function buildCrosshairInfo(key, value) {
        const meta = D_META[key];
        if (!activeDValues[key] || value === null || !Number.isFinite(value)) {
            return { data: [], label: `D${key}`, info: '' };
        }
        const dText = value.toFixed(3);
        const info = `D${key} = ${dText} mm — diametro corrispondente al ${meta.percent}% di passante. ${meta.formula}.`;
        return {
            data: [
                { x: value, y: 0 },
                { x: value, y: meta.percent },
                { x: X_AXIS_MAX, y: meta.percent }
            ],
            label: `D${key} = ${dText} mm`,
            info
        };
    }

    // Aggiorna la fila di "chip" informative sotto ai tasti D10/D30/D60
    function updateDInfoPanel(dValues) {
        if (!dInfoEl) return;
        const activeKeys = [10, 30, 60].filter(k => activeDValues[k]);
        if (activeKeys.length === 0) {
            dInfoEl.innerHTML = '<span class="gran-small-note">Clicca D&#8321;&#8320;, D&#8323;&#8320; o D&#8326;&#8320; per evidenziare il punto sulla curva (valore e formula compaiono anche passando il mouse sul grafico).</span>';
            return;
        }
        dInfoEl.innerHTML = activeKeys.map(k => {
            const value = dValues[k];
            const meta = D_META[k];
            if (value === null || !Number.isFinite(value)) {
                return `<span class="gran-d-chip" style="--d-color:${meta.color}">D<sub>${k}</sub>: fuori dal range dei dati inseriti</span>`;
            }
            return `<span class="gran-d-chip" style="--d-color:${meta.color}">D<sub>${k}</sub> = ${fmt(value, 3)} mm &middot; ${meta.formula}</span>`;
        }).join('');
    }

    function updateGranChart(points, dValues) {
        const ctx = document.getElementById('granChart').getContext('2d');
        const curveData = points.map(pt => ({ x: pt.d, y: pt.p }));
        const cross10 = buildCrosshairInfo(10, dValues ? dValues[10] : null);
        const cross30 = buildCrosshairInfo(30, dValues ? dValues[30] : null);
        const cross60 = buildCrosshairInfo(60, dValues ? dValues[60] : null);

        if (granChart) {
            granChart.data.datasets[0].data = curveData;
            [[10, cross10], [30, cross30], [60, cross60]].forEach(([key, cross]) => {
                const ds = granChart.data.datasets[D_DATASET_INDEX[key]];
                ds.data = cross.data;
                ds.label = cross.label;
                ds.dInfo = cross.info;
            });
            granChart.update();
            updateDInfoPanel(dValues || { 10: null, 30: null, 60: null });
            return;
        }

        granChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Curva granulometrica',
                        data: curveData,
                        borderColor: '#1E507F',
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        pointRadius: 3,
                        pointBackgroundColor: '#1E507F',
                        tension: 0
                    },
                    {
                        label: 'Ghiaia/Sabbia (2mm)',
                        data: refLine(2),
                        borderColor: '#d69e2e',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointRadius: 0
                    },
                    {
                        label: 'Sabbia/Limo (0.06mm)',
                        data: refLine(0.06),
                        borderColor: '#975a16',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointRadius: 0
                    },
                    {
                        label: 'Limo/Argilla (0.002mm)',
                        data: refLine(0.002),
                        borderColor: '#742a2a',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointRadius: 0
                    },
                    {
                        label: 'Setaccio n.200 USCS (0.075mm)',
                        data: refLine(0.075),
                        borderColor: '#a0aec0',
                        borderWidth: 1.5,
                        borderDash: [2, 3],
                        pointRadius: 0
                    },
                    {
                        label: cross10.label,
                        data: cross10.data,
                        dInfo: cross10.info,
                        borderColor: D_META[10].color,
                        backgroundColor: D_META[10].color,
                        borderWidth: 2,
                        pointRadius: [0, 6, 0],
                        pointHoverRadius: [0, 8, 0],
                        tension: 0
                    },
                    {
                        label: cross30.label,
                        data: cross30.data,
                        dInfo: cross30.info,
                        borderColor: D_META[30].color,
                        backgroundColor: D_META[30].color,
                        borderWidth: 2,
                        pointRadius: [0, 6, 0],
                        pointHoverRadius: [0, 8, 0],
                        tension: 0
                    },
                    {
                        label: cross60.label,
                        data: cross60.data,
                        dInfo: cross60.info,
                        borderColor: D_META[60].color,
                        backgroundColor: D_META[60].color,
                        borderWidth: 2,
                        pointRadius: [0, 6, 0],
                        pointHoverRadius: [0, 8, 0],
                        tension: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'logarithmic',
                        reverse: true,
                        min: X_AXIS_MIN,
                        max: X_AXIS_MAX,
                        title: { display: true, text: 'Diametro (mm)' }
                    },
                    y: {
                        type: 'linear',
                        min: 0,
                        max: 100,
                        title: { display: true, text: 'Passante (%)' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 16, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            title: items => `d = ${parseFloat(items[0].parsed.x.toFixed(3))} mm`,
                            label: item => item.dataset.dInfo ? item.dataset.dInfo : `${item.dataset.label}: ${item.parsed.y.toFixed(1)}%`
                        }
                    }
                }
            }
        });

        updateDInfoPanel(dValues || { 10: null, 30: null, 60: null });
    }

    function updateCasagrandeChart(Ip, wL) {
        const ctx = document.getElementById('casagrandeChart').getContext('2d');
        const aLineData = [{ x: 20, y: 0 }, { x: 100, y: 0.73 * 80 }];
        const uLineData = [{ x: 8, y: 0 }, { x: 100, y: 0.9 * 92 }];
        const familyLineData = [{ x: 50, y: 0 }, { x: 50, y: 60 }];
        const pointData = (Ip !== null && wL !== null && Ip >= 0) ? [{ x: wL, y: Ip }] : [];

        if (casagrandeChart) {
            casagrandeChart.data.datasets[3].data = pointData;
            casagrandeChart.update();
            return;
        }

        casagrandeChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Retta A: Ip=0.73(wL-20)',
                        data: aLineData,
                        borderColor: '#2d3748',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0
                    },
                    {
                        label: 'Retta U: Ip=0.9(wL-8)',
                        data: uLineData,
                        borderColor: '#a0aec0',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        tension: 0
                    },
                    {
                        label: 'wL = 50 (L/H)',
                        data: familyLineData,
                        borderColor: '#cbd5e0',
                        borderWidth: 1,
                        borderDash: [2, 3],
                        pointRadius: 0,
                        tension: 0
                    },
                    {
                        label: 'Campione',
                        data: pointData,
                        borderColor: '#e53e3e',
                        backgroundColor: '#e53e3e',
                        pointRadius: 7,
                        pointStyle: 'circle',
                        showLine: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: 110,
                        title: { display: true, text: 'Limite liquido w_L (%)' }
                    },
                    y: {
                        type: 'linear',
                        min: 0,
                        max: 60,
                        title: { display: true, text: 'Indice di plasticità I_P (%)' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 16, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: item => `${item.dataset.label}: (wL=${item.parsed.x}, Ip=${item.parsed.y})`
                        }
                    }
                }
            },
            plugins: [casagrandeLabelsPlugin]
        });
    }

    renderGranTable();
    recompute();
}

/* ============================================================
   Modulo 5: Gradiente Idraulico Critico e Sifonamento
   ============================================================

   Colonna verticale di terreno saturo (permeametro), percorsa da un flusso
   d'acqua imposto da un dislivello Δh fra due serbatoi. z è la profondità
   misurata dalla testa della colonna (z=0) alla base (z=L).

   Formule (vedi slide "Pressioni efficaci in condizioni idrodinamiche"):
     i  = Δh / L                  gradiente idraulico applicato
     ic = γ' / γw                 gradiente idraulico critico (γ' = γsat - γw)

     flusso verso il basso:  u(z) = γw z (1 - i)     σ'(z) = z (γ' + γw i)   → σ' AUMENTA
     flusso verso l'alto:    u(z) = γw z (1 + i)     σ'(z) = z (γ' - γw i)   → σ' DIMINUISCE

   Essendo σ'(z) proporzionale a z con pendenza costante, se il flusso verso
   l'alto raggiunge i >= ic la tensione efficace si annulla (e diventerebbe
   negativa) su TUTTA l'altezza della colonna, non solo in un punto: da qui la
   scelta di trattare "sifonamento" come uno stato binario dell'intera colonna
   (stabile / liquefatta) invece che una soglia puntuale sul grafico. */

function initSeepageModule() {
    const gammaW = 9.81;

    const LInput = document.getElementById('sif-L');
    const dhInput = document.getElementById('sif-dh');
    const gammaSatInput = document.getElementById('sif-gammasat');
    const flowDownBtn = document.getElementById('flow-down');
    const flowUpBtn = document.getElementById('flow-up');

    if (!LInput || !dhInput || !gammaSatInput || !flowDownBtn || !flowUpBtn) return;

    const valL = document.getElementById('val-sif-L');
    const valDh = document.getElementById('val-sif-dh');
    const valGammaSat = document.getElementById('val-sif-gammasat');

    const iOut = document.getElementById('sif-i');
    const icOut = document.getElementById('sif-ic');
    const sigmaLOut = document.getElementById('sif-sigmaL');
    const statusEl = document.getElementById('sif-status');

    const gaugeFill = document.getElementById('sif-gauge-fill');
    const gaugeMarker = document.getElementById('sif-gauge-marker');

    const columnEl = document.getElementById('sif-column');
    const columnWrapEl = document.getElementById('sif-column-wrap');
    const soilLogEl = document.getElementById('sif-soil-log');
    const arrowsEl = document.getElementById('sif-flow-arrows');
    const moduleContentEl = document.getElementById('sifChart').closest('.module-content');

    let direction = 'down';
    let sifChart = null;
    const ctx = document.getElementById('sifChart').getContext('2d');

    flowDownBtn.addEventListener('click', () => { direction = 'down'; update(); });
    flowUpBtn.addEventListener('click', () => { direction = 'up'; update(); });

    // Allinea SOLO la colonna di terreno all'area di disegno del grafico (stesso
    // meccanismo già usato nel modulo "Tensioni"): grafico, log e serbatoio restano
    // sempre ancorati a questo calcolo. Il pannello controlli invece NON segue più
    // questo allineamento: resta fisso vicino al titolo del modulo (vedi la regola
    // ".controls-panel" scoped nel CSS, che lo tiene appena sotto l'intestazione
    // indipendentemente da dove si trovi il grafico/la colonna/il serbatoio).
    function syncColumnToChart() {
        if (!sifChart || !columnEl) return;
        const area = sifChart.chartArea;
        if (columnWrapEl) columnWrapEl.style.marginTop = area.top + 'px';
        columnEl.style.height = (area.bottom - area.top) + 'px';
    }

    function update() {
        const L = parseFloat(LInput.value);
        const dh = parseFloat(dhInput.value);
        const gammaSat = parseFloat(gammaSatInput.value);
        const gammaPrime = gammaSat - gammaW;

        valL.textContent = L.toFixed(1);
        valDh.textContent = dh.toFixed(1);
        valGammaSat.textContent = gammaSat.toFixed(1);

        flowDownBtn.classList.toggle('active', direction === 'down');
        flowUpBtn.classList.toggle('active', direction === 'up');

        const i = dh / L;
        const ic = gammaPrime / gammaW;
        const isLiquefied = direction === 'up' && i >= ic - 1e-9;

        // Griglia di profondità a passo fine, da 0 (testa) a L (base della colonna)
        const steps = 40;
        const depths = [];
        for (let k = 0; k <= steps; k++) depths.push((L * k) / steps);

        const sigmaTot = [];
        const u = [];
        const sigmaEff = [];
        depths.forEach(z => {
            const tot = gammaSat * z;
            let pore, eff;
            if (direction === 'down') {
                pore = gammaW * z * (1 - i);
                eff = z * (gammaPrime + gammaW * i);
            } else {
                pore = gammaW * z * (1 + i);
                eff = z * (gammaPrime - gammaW * i);
            }
            sigmaTot.push(parseFloat(tot.toFixed(2)));
            u.push(parseFloat(pore.toFixed(2)));
            sigmaEff.push(parseFloat(eff.toFixed(2)));
        });

        const sigmaAtBase = sigmaEff[sigmaEff.length - 1];

        iOut.textContent = i.toFixed(2);
        icOut.textContent = ic.toFixed(2);
        sigmaLOut.textContent = sigmaAtBase.toFixed(1) + ' kPa';

        // --- Indicatore i / ic ---
        const gaugeMax = Math.max(ic * 1.5, i * 1.1, 0.1);
        const fillPct = Math.min(i, gaugeMax) / gaugeMax * 100;
        const markerPct = Math.min(ic, gaugeMax) / gaugeMax * 100;
        gaugeFill.style.width = fillPct + '%';
        gaugeMarker.style.left = markerPct + '%';
        gaugeFill.classList.toggle('sif-gauge-fill-critical', isLiquefied);
        gaugeFill.classList.toggle('sif-gauge-fill-neutral', direction === 'down');
        gaugeFill.classList.toggle('sif-gauge-fill-ok', direction === 'up' && !isLiquefied);

        // --- Messaggio di stato ---
        statusEl.classList.remove('sif-status-ok', 'sif-status-critical', 'sif-status-neutral');
        if (direction === 'down') {
            statusEl.textContent = 'Il flusso verso il basso AUMENTA la tensione efficace: nessun rischio di sifonamento.';
            statusEl.classList.add('sif-status-neutral');
        } else if (isLiquefied) {
            statusEl.textContent = 'ATTENZIONE: i ≥ i꜀ — sifonamento e liquefazione della colonna (σ\' ≤ 0 su tutta l\'altezza).';
            statusEl.classList.add('sif-status-critical');
        } else {
            statusEl.textContent = 'Regime stabile: i < i꜀, la tensione efficace resta positiva su tutta la colonna.';
            statusEl.classList.add('sif-status-ok');
        }

        // --- Colonna di terreno e frecce di flusso ---
        // Riscrive l'HTML solo quando lo stato sifonamento sì/no cambia davvero:
        // altrimenti, muovendo uno slider, l'elemento veniva ricreato ad ogni
        // singolo tick e la sua animazione CSS (le strisce) ripartiva sempre da
        // capo invece di scorrere in continuo.
        if (soilLogEl && soilLogEl.dataset.liquefied !== String(isLiquefied)) {
            soilLogEl.innerHTML = isLiquefied
                ? '<div class="soil-layer sif-layer sif-layer-liquefied" style="top:0; height:100%;"><span class="sif-liquefied-label">SIFONAMENTO</span></div>'
                : '<div class="soil-layer sif-layer" style="top:0; height:100%;">Terreno saturo</div>';
            soilLogEl.dataset.liquefied = String(isLiquefied);
        }
        if (arrowsEl) {
            arrowsEl.querySelectorAll('.sif-arrow').forEach(a => { a.textContent = direction === 'up' ? '▲' : '▼'; });
            arrowsEl.classList.toggle('flow-up', direction === 'up');
            arrowsEl.classList.toggle('flow-down', direction === 'down');
        }
        if (columnWrapEl) columnWrapEl.classList.toggle('flow-up', direction === 'up');
        if (moduleContentEl) {
            // Riserva lo spazio per il serbatoio dal lato in cui si trova (sopra se il
            // flusso è verso il basso, sotto se è verso l'alto), così non si sovrappone
            // mai all'intestazione del modulo né sfalsa l'allineamento col pannello controlli.
            moduleContentEl.classList.toggle('sif-reserve-top', direction === 'down');
            moduleContentEl.classList.toggle('sif-reserve-bottom', direction === 'up');
        }
        if (columnEl) columnEl.classList.toggle('sif-column-critical', isLiquefied);

        // --- Grafico σ, u, σ' vs profondità ---
        const ptTot = depths.map((d, idx) => ({ x: sigmaTot[idx], y: d }));
        const ptU = depths.map((d, idx) => ({ x: u[idx], y: d }));
        const ptEff = depths.map((d, idx) => ({ x: sigmaEff[idx], y: d }));
        const zeroLine = [{ x: 0, y: 0 }, { x: 0, y: L }];

        const allVals = sigmaTot.concat(u, sigmaEff, [0, 20]);
        const rawMax = Math.max(...allVals) * 1.15;
        const rawMin = Math.min(...allVals) * 1.15;
        const xMax = Math.max(20, Math.ceil(rawMax / 20) * 20);
        const xMin = Math.min(0, Math.floor(rawMin / 20) * 20);

        if (sifChart) {
            sifChart.data.datasets[0].data = ptTot;
            sifChart.data.datasets[1].data = ptU;
            sifChart.data.datasets[2].data = ptEff;
            sifChart.data.datasets[3].data = zeroLine;
            sifChart.options.scales.x.max = xMax;
            sifChart.options.scales.x.min = xMin;
            sifChart.options.scales.y.max = L;
            // 'none': niente animazione, per coerenza con lo stesso fix già applicato
            // al modulo "Tensioni" (evita disallineamenti fra grafico e overlay).
            sifChart.update('none');
            syncColumnToChart();
        } else {
            sifChart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        { label: 'Totale (σ)', data: ptTot, borderColor: '#e53e3e', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0 },
                        { label: 'Interstiziale (u)', data: ptU, borderColor: '#1E507F', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, tension: 0 },
                        { label: "Efficace (σ')", data: ptEff, borderColor: '#38a169', backgroundColor: 'rgba(56, 161, 105, 0.12)', borderWidth: 3, fill: { target: { value: 0 }, above: 'rgba(56, 161, 105, 0.12)', below: 'rgba(229, 62, 62, 0.18)' }, pointRadius: 0, tension: 0 },
                        { label: "σ' = 0", data: zeroLine, borderColor: '#a0aec0', backgroundColor: 'transparent', borderWidth: 1, borderDash: [3, 3], pointRadius: 0, tension: 0 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { onComplete: () => syncColumnToChart() },
                    scales: {
                        y: {
                            type: 'linear',
                            reverse: true,
                            min: 0,
                            max: L,
                            title: { display: true, text: 'Profondità nel campione z (m)' }
                        },
                        x: {
                            type: 'linear',
                            position: 'top',
                            min: xMin,
                            max: xMax,
                            title: { display: true, text: 'Pressione / Tensione (kPa)' },
                            ticks: {
                                stepSize: 20,
                                callback: value => Math.round(value)
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { boxWidth: 20, padding: 14, font: { size: 12 } }
                        },
                        tooltip: {
                            mode: 'nearest',
                            intersect: false,
                            callbacks: {
                                title: items => `z = ${items[0].parsed.y.toFixed(2)} m`,
                                label: item => `${item.dataset.label}: ${item.parsed.x.toFixed(1)} kPa`
                            }
                        }
                    }
                }
            });
        }
    }

    [LInput, dhInput, gammaSatInput].forEach(input => input.addEventListener('input', update));

    update();
}

function initEdometricModule() {

    // ============================================================
    // Utilità geometriche/numeriche condivise dai tre sotto-moduli
    // ============================================================

    // Regressione lineare ai minimi quadrati su punti {x,y} -> {slope, intercept}
    function linreg(pts) {
        const n = pts.length;
        if (n === 0) return { slope: 0, intercept: 0 };
        if (n === 1) return { slope: 0, intercept: pts[0].y };
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        pts.forEach(p => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
        const denom = n * sxx - sx * sx;
        if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sy / n };
        const slope = (n * sxy - sx * sy) / denom;
        const intercept = (sy - slope * sx) / n;
        return { slope, intercept };
    }

    // Intersezione fra due rette, ciascuna definita da un punto e un vettore direzione.
    // Restituisce {x, y, t} (t = parametro lungo la prima retta) oppure null se parallele.
    function lineIntersect(p1, d1, p2, d2) {
        const denom = d1.x * d2.y - d1.y * d2.x;
        if (Math.abs(denom) < 1e-9) return null;
        const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
        return { x: p1.x + t * d1.x, y: p1.y + t * d1.y, t };
    }

    // Interpolazione lineare di y al valore x dato, su punti {x,y} ordinati per x crescente
    function interpY(points, x) {
        if (x <= points[0].x) return points[0].y;
        const last = points[points.length - 1];
        if (x >= last.x) return last.y;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i], p1 = points[i + 1];
            if (x >= p0.x && x <= p1.x) {
                if (p1.x === p0.x) return (p0.y + p1.y) / 2;
                const f = (x - p0.x) / (p1.x - p0.x);
                return p0.y + f * (p1.y - p0.y);
            }
        }
        return last.y;
    }

    // Interpolazione inversa: trova x tale che y(x) = target, assumendo y monotona crescente
    // su punti {x,y} ordinati per x crescente.
    function interpX(points, yTarget) {
        if (yTarget <= points[0].y) return points[0].x;
        const last = points[points.length - 1];
        if (yTarget >= last.y) return last.x;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i], p1 = points[i + 1];
            if (yTarget >= p0.y && yTarget <= p1.y) {
                if (p1.y === p0.y) return p0.x;
                const f = (yTarget - p0.y) / (p1.y - p0.y);
                return p0.x + f * (p1.x - p0.x);
            }
        }
        return last.x;
    }

    // Grado di consolidazione U in funzione del fattore tempo Tv (formule approssimate
    // di uso corrente: Tv = (pi/4)U^2 per U<=60%, Tv = -0.933*log10(1-U) - 0.085 per U>60%)
    function UofTv(Tv) {
        if (Tv <= 0.283) return 2 * Math.sqrt(Tv / Math.PI);
        const U = 1 - Math.pow(10, -(Tv + 0.085) / 0.933);
        return Math.min(U, 0.9999);
    }

    // Modello sintetico deformazione(t) di un gradino di carico edometrico: comprende
    // una compressione istantanea (ro), la consolidazione primaria secondo Terzaghi
    // (funzione di cv, d) e una coda di compressione secondaria (rs), cosi' da avere una
    // curva realistica su cui esercitare sia il metodo di Casagrande sia quello di Taylor.
    const Y_PRIMARY = 6; // mm, ampiezza di riferimento della compressione primaria
    function deformAt(t, cv, d, ro, rs) {
        const Tv = cv * t / (d * d);
        const U = UofTv(Tv);
        const y0 = ro * Y_PRIMARY * 0.6;
        const secStart = Math.max(0.8 * (d * d / cv), 0.01);
        const sec = rs * Y_PRIMARY * Math.log10(1 + t / secStart);
        return y0 + Y_PRIMARY * U + sec;
    }

    function fmtSigned(x, decimals) {
        if (!Number.isFinite(x)) return '—';
        return (x >= 0 ? '+' : '') + x.toFixed(decimals) + '%';
    }

    // cv dalle formule di Casagrande/Taylor viene fuori naturalmente in cm²/min
    // (d in cm, t in min): 1 cm²/min = 1e-4 m² / 60 s = 1e-4/60 m²/s.
    const CM2_PER_MIN_TO_M2_PER_S = 1e-4 / 60;
    const SUPERSCRIPT_DIGITS = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

    // Formatta cv (dato in cm²/min) come notazione scientifica in m²/s,
    // es. "1.45 × 10⁻⁸ m²/s" — i valori reali di cv sono troppo piccoli in
    // m²/s per una notazione decimale semplice (tipicamente 1e-9 ÷ 1e-6).
    function formatCvM2S(cvCm2PerMin) {
        if (!Number.isFinite(cvCm2PerMin) || cvCm2PerMin <= 0) return '—';
        const v = cvCm2PerMin * CM2_PER_MIN_TO_M2_PER_S;
        const exp = Math.floor(Math.log10(v));
        const mantissa = v / Math.pow(10, exp);
        const expStr = String(exp).split('').map(c => SUPERSCRIPT_DIGITS[c] || c).join('');
        return mantissa.toFixed(2) + ' × 10' + expStr + ' m²/s';
    }

    // ============================================================
    // Sotto-schede del modulo (σ'p / cv Casagrande / cv Taylor)
    // ============================================================
    function initEdoSubTabs() {
        const buttons = document.querySelectorAll('.edo-subtab-btn');
        const panels = document.querySelectorAll('[data-edo-subpanel]');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => {
                    const active = b === btn;
                    b.classList.toggle('active', active);
                    b.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                const name = btn.dataset.subtab;
                panels.forEach(p => { p.hidden = p.dataset.edoSubpanel !== name; });
            });
        });
    }

    // ============================================================
    // Sotto-modulo A: pressione di preconsolidazione, metodo di Casagrande
    // ============================================================
    function initSigmaPTool() {
        const tbody = document.getElementById('sp-table-body');
        const addRowBtn = document.getElementById('sp-add-row');
        const hintOut = document.getElementById('sp-hint');
        const eAOut = document.getElementById('sp-eA');
        const slopeOut = document.getElementById('sp-slope');
        const estOut = document.getElementById('sp-est');

        const btnSuggest = document.getElementById('sp-btn-suggest');
        const btnHoriz = document.getElementById('sp-btn-horiz');
        const btnTan = document.getElementById('sp-btn-tan');
        const btnBis = document.getElementById('sp-btn-bis');
        const btnVirgin = document.getElementById('sp-btn-virgin');
        const btnD = document.getElementById('sp-btn-d');
        const btnReset = document.getElementById('sp-btn-reset');

        // Dati di partenza: una tipica sequenza di carichi raddoppiati di una prova
        // edometrica. I dati restano interamente modificabili dalla tabella.
        let points = [
            { sigma: 12, e: 0.897 },
            { sigma: 25, e: 0.884 },
            { sigma: 50, e: 0.871 },
            { sigma: 100, e: 0.854 },
            { sigma: 200, e: 0.806 },
            { sigma: 400, e: 0.724 },
            { sigma: 800, e: 0.635 },
            { sigma: 1600, e: 0.545 }
        ];

        let chart = null;
        let A = null;        // { x: log10(sigma) } oppure null
        let hasHoriz = false;
        let hasTan = false;
        let hasBis = false;
        let virgin = null;   // { slope, intercept } nel piano (log10 sigma, e)
        let D = null;        // { x, e, sigma, t }

        // --- Tabella dati (sigma', e), editabile come nella Granulometria ---
        function renderTable() {
            tbody.innerHTML = '';
            points.forEach((pt, idx) => {
                const tr = document.createElement('tr');

                const tdS = document.createElement('td');
                const inputS = document.createElement('input');
                inputS.type = 'number';
                inputS.step = 'any';
                inputS.min = '0';
                inputS.value = pt.sigma;
                inputS.addEventListener('input', () => {
                    points[idx].sigma = parseFloat(inputS.value);
                    recompute();
                });
                tdS.appendChild(inputS);

                const tdE = document.createElement('td');
                const inputE = document.createElement('input');
                inputE.type = 'number';
                inputE.step = 'any';
                inputE.min = '0';
                inputE.value = pt.e;
                inputE.addEventListener('input', () => {
                    points[idx].e = parseFloat(inputE.value);
                    recompute();
                });
                tdE.appendChild(inputE);

                const tdDel = document.createElement('td');
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'gran-remove-row';
                delBtn.innerHTML = '&times;';
                delBtn.title = 'Rimuovi punto';
                delBtn.addEventListener('click', () => {
                    points.splice(idx, 1);
                    renderTable();
                    recompute();
                });
                tdDel.appendChild(delBtn);

                tr.appendChild(tdS);
                tr.appendChild(tdE);
                tr.appendChild(tdDel);
                tbody.appendChild(tr);
            });
        }

        addRowBtn.addEventListener('click', () => {
            const last = points[points.length - 1];
            const newSigma = last ? Math.round(last.sigma * 2) : 100;
            const newE = last ? Math.max(0.05, last.e - 0.05) : 0.8;
            points.push({ sigma: newSigma, e: newE });
            renderTable();
            recompute();
        });

        // --- Spline cubica monotona di Hermite (Fritsch-Carlson) su (log10 sigma, e) ---
        // Traccia una curva liscia e priva di sbandate attraverso i punti di prova
        // inseriti, e ne fornisce pendenza e curvatura in un punto qualsiasi: e' la
        // base per la costruzione grafica del metodo di Casagrande.
        function buildSpline(pts) {
            const n = pts.length;
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            if (n < 2) return null;
            const d = [];
            for (let i = 0; i < n - 1; i++) {
                const h = xs[i + 1] - xs[i];
                d.push(h !== 0 ? (ys[i + 1] - ys[i]) / h : 0);
            }
            const m = new Array(n);
            m[0] = d[0];
            m[n - 1] = d[n - 2];
            for (let i = 1; i < n - 1; i++) {
                if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] > 0) !== (d[i] > 0)) {
                    m[i] = 0;
                } else {
                    m[i] = (d[i - 1] + d[i]) / 2;
                }
            }
            for (let i = 0; i < n - 1; i++) {
                if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
                const a = m[i] / d[i], b = m[i + 1] / d[i];
                const s = a * a + b * b;
                if (s > 9) {
                    const tau = 3 / Math.sqrt(s);
                    m[i] = tau * a * d[i];
                    m[i + 1] = tau * b * d[i];
                }
            }
            return { xs, ys, m };
        }

        function splineEval(sp, x) {
            const { xs, ys, m } = sp;
            const n = xs.length;
            // Fuori dal dominio dei dati: estrapolazione lineare secondo la tangente
            // al bordo (non un valore costante), per evitare un "gomito" artificiale
            // in derivata seconda proprio ai bordi del dominio.
            if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
            if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
            let i = 0;
            while (i < n - 2 && x > xs[i + 1]) i++;
            const h = xs[i + 1] - xs[i];
            const t = (x - xs[i]) / h;
            const t2 = t * t, t3 = t2 * t;
            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + t;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;
            return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
        }

        function splineSlope(sp, x) {
            const h = 0.005;
            return (splineEval(sp, x + h) - splineEval(sp, x - h)) / (2 * h);
        }

        function splineCurvature(sp, x) {
            const h = 0.01;
            const y0 = splineEval(sp, x - h), y1 = splineEval(sp, x), y2 = splineEval(sp, x + h);
            const d1 = (y2 - y0) / (2 * h);
            const d2 = (y2 - 2 * y1 + y0) / (h * h);
            return Math.abs(d2) / Math.pow(1 + d1 * d1, 1.5);
        }

        // Arrotonda i confini dell'asse log ai valori "puliti" 1-2-5 x 10^n piu'
        // vicini (per difetto/eccesso), cosi' l'asse non mostra numeri scomodi
        // come 12 o 1600 e i tick non si accavallano.
        function niceFloor(v) {
            const exp = Math.floor(Math.log10(v));
            const base = Math.pow(10, exp);
            let best = base;
            [1, 2, 5, 10].forEach(mult => { if (mult * base <= v + 1e-9) best = mult * base; });
            return best;
        }
        function niceCeil(v) {
            const exp = Math.floor(Math.log10(v));
            const base = Math.pow(10, exp);
            const candidates = [1, 2, 5, 10].map(mult => mult * base);
            for (const c of candidates) if (c >= v - 1e-9) return c;
            return candidates[candidates.length - 1];
        }

        function validPoints() {
            const raw = points
                .map(pt => ({ x: Math.log10(parseFloat(pt.sigma)), y: parseFloat(pt.e), sigma: parseFloat(pt.sigma) }))
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
                .sort((a, b) => a.x - b.x);
            const out = [];
            raw.forEach(pt => {
                if (out.length && Math.abs(out[out.length - 1].x - pt.x) < 1e-9) {
                    out[out.length - 1] = pt;
                } else {
                    out.push(pt);
                }
            });
            return out;
        }

        function clearConstruction(clearVirgin) {
            A = null;
            hasHoriz = false;
            hasTan = false;
            hasBis = false;
            D = null;
            if (clearVirgin) virgin = null;
        }

        function updateButtons(vp) {
            const enough = vp.length >= 2;
            btnSuggest.disabled = vp.length < 3;
            btnHoriz.disabled = !(enough && A);
            btnTan.disabled = !(enough && A);
            btnBis.disabled = !(enough && A && hasHoriz && hasTan);
            // La retta vergine non richiederebbe geometricamente la bisettrice (dipende
            // solo dai dati), ma la si abilita solo a bisettrice fatta per rispettare
            // l'ordine dei passi 1-5 mostrato nei pulsanti ed evitare di farla comparire
            // come un pulsante "sempre attivo" scollegato dal resto della costruzione.
            btnVirgin.disabled = !(enough && hasBis);
            btnD.disabled = !(hasBis && virgin);
            btnReset.disabled = !(A || virgin);
        }

        btnSuggest.addEventListener('click', () => {
            const vp = validPoints();
            if (vp.length < 3) return;
            const sp = buildSpline(vp);
            const x0 = vp[0].x, x1 = vp[vp.length - 1].x;
            const NS = 240;
            let bestX = (x0 + x1) / 2, bestK = -1;
            for (let i = 1; i < NS; i++) {
                const x = x0 + (x1 - x0) * i / NS;
                const k = splineCurvature(sp, x);
                if (k > bestK) { bestK = k; bestX = x; }
            }
            clearConstruction(false);
            A = { x: bestX };
            updateButtons(vp);
            recompute();
        });

        btnHoriz.addEventListener('click', () => {
            if (!A) return;
            hasHoriz = true;
            updateButtons(validPoints());
            recompute();
        });

        btnTan.addEventListener('click', () => {
            if (!A) return;
            hasTan = true;
            updateButtons(validPoints());
            recompute();
        });

        btnBis.addEventListener('click', () => {
            if (!A || !hasHoriz || !hasTan) return;
            hasBis = true;
            updateButtons(validPoints());
            recompute();
        });

        btnVirgin.addEventListener('click', () => {
            const vp = validPoints();
            if (vp.length < 2) return;
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            const span = xMax - xMin;
            let tail = vp.filter(p => p.x >= xMax - 0.3 * span);
            if (tail.length < 2) tail = vp.slice(-2);
            virgin = linreg(tail);
            updateButtons(vp);
            recompute();
        });

        btnD.addEventListener('click', () => {
            const vp = validPoints();
            if (!hasBis || !virgin || !A || vp.length < 2) return;
            const sp = buildSpline(vp);
            const eA = splineEval(sp, A.x);
            const mTan = splineSlope(sp, A.x);
            const u1 = { x: 1, y: 0 };
            const norm2 = Math.sqrt(1 + mTan * mTan);
            const u2 = { x: 1 / norm2, y: mTan / norm2 };
            const bisDir = { x: u1.x + u2.x, y: u1.y + u2.y };
            const virginPoint = { x: 0, y: virgin.intercept };
            const virginDir = { x: 1, y: virgin.slope };
            const inter = lineIntersect({ x: A.x, y: eA }, bisDir, virginPoint, virginDir);
            if (inter) D = { x: inter.x, e: inter.y, sigma: Math.pow(10, inter.x), t: inter.t };
            updateButtons(vp);
            recompute();
        });

        btnReset.addEventListener('click', () => {
            clearConstruction(true);
            updateButtons(validPoints());
            recompute();
        });

        // --- Selezione del punto A: clic direttamente sul grafico, lungo la curva ---
        const canvas = document.getElementById('sigmapChart');
        canvas.addEventListener('click', (evt) => {
            const vp = validPoints();
            if (vp.length < 2 || !chart) return;
            const rect = canvas.getBoundingClientRect();
            const xPix = evt.clientX - rect.left;
            const scaleX = chart.scales && chart.scales.x;
            if (!scaleX || typeof scaleX.getValueForPixel !== 'function') return;
            const sigmaClick = scaleX.getValueForPixel(xPix);
            if (!Number.isFinite(sigmaClick) || sigmaClick <= 0) return;
            let xLog = Math.log10(sigmaClick);
            xLog = Math.min(Math.max(xLog, vp[0].x), vp[vp.length - 1].x);
            clearConstruction(false);
            A = { x: xLog };
            updateButtons(vp);
            recompute();
        });

        function updateHint(vp) {
            if (vp.length < 2) {
                hintOut.textContent = "Inserisci almeno due punti (σ', e) validi per tracciare la curva.";
                hintOut.className = 'sif-status sif-status-critical';
            } else if (!A) {
                hintOut.textContent = 'Passo 1: clicca sul grafico per posizionare il punto A.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasHoriz || !hasTan) {
                hintOut.textContent = "Passo 2: crea l'orizzontale e la tangente in A.";
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasBis) {
                hintOut.textContent = "Passo 3: crea la bisettrice.";
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!virgin) {
                hintOut.textContent = 'Passo 4: crea la retta vergine.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!D) {
                hintOut.textContent = 'Passo 5: trova il punto D.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else {
                hintOut.textContent = "Costruzione completata: σ'p è l'ascissa del punto D.";
                hintOut.className = 'sif-status sif-status-ok';
            }
        }

        function recompute() {
            const vp = validPoints();
            updateButtons(vp);
            updateHint(vp);

            const rawData = points
                .map(pt => ({ x: parseFloat(pt.sigma), y: parseFloat(pt.e) }))
                .filter(pt => Number.isFinite(pt.x) && pt.x > 0 && Number.isFinite(pt.y));

            if (vp.length < 2) {
                eAOut.textContent = '—';
                slopeOut.textContent = '—';
                estOut.textContent = '— kPa';
                if (chart) {
                    chart.data.datasets.forEach(ds => { ds.data = []; });
                    chart.data.datasets[1].data = rawData;
                    chart.update('none');
                }
                return;
            }

            const sp = buildSpline(vp);
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            const sigmaMin = vp[0].sigma, sigmaMax = vp[vp.length - 1].sigma;

            const N = 160;
            const curveData = [];
            for (let i = 0; i <= N; i++) {
                const x = xMin + (xMax - xMin) * i / N;
                curveData.push({ x: Math.pow(10, x), y: splineEval(sp, x) });
            }

            let eA = null, mTan = null;
            if (A) {
                eA = splineEval(sp, A.x);
                mTan = splineSlope(sp, A.x);
            }
            eAOut.textContent = A ? eA.toFixed(3) : '—';
            slopeOut.textContent = (A && hasTan) ? mTan.toFixed(3) : '—';
            estOut.textContent = D ? D.sigma.toFixed(0) + ' kPa' : '— kPa';

            const xLeftEdge = niceFloor(sigmaMin);
            const xRightEdge = niceCeil(sigmaMax);
            const xLeftEdgeLog = Math.log10(xLeftEdge), xRightEdgeLog = Math.log10(xRightEdge);

            let virginData = [];
            if (virgin) {
                // Il tratto disegnato deve arrivare visibilmente oltre il punto D (o, se
                // D non e' ancora stato trovato, oltre il punto A): altrimenti la retta
                // vergine resta confinata al tratto finale gia' rettilineo della curva e
                // sembra "prolungare" la curva stessa invece di mostrare lo scostamento
                // che serve alla costruzione. Estrapolare pero' troppo oltre il dominio
                // dei dati esagera l'incertezza della pendenza e distorce la scala di e,
                // quindi il margine e' comunque limitato al dominio dei dati.
                const segSpan = 1.0;
                let leftLog = xRightEdgeLog - segSpan;
                const margin = 0.15;
                if (D) leftLog = Math.min(leftLog, D.x - margin);
                else if (A) leftLog = Math.min(leftLog, A.x - margin);
                leftLog = Math.max(leftLog, xLeftEdgeLog, xMin - 0.1);
                virginData = [
                    { x: Math.pow(10, leftLog), y: virgin.intercept + virgin.slope * leftLog },
                    { x: xRightEdge, y: virgin.intercept + virgin.slope * xRightEdgeLog }
                ];
            }

            let horizData = [];
            if (A && hasHoriz) {
                horizData = [{ x: Math.pow(10, A.x), y: eA }, { x: xRightEdge, y: eA }];
            }

            let tanData = [];
            if (A && hasTan) {
                // Segmento allungato (era 0.35) per renderlo ben visibile rispetto
                // alla curva: resta comunque clampato al dominio dei dati (xMin/xMax).
                const dx = 0.55;
                const xL = Math.max(xMin, A.x - dx), xR = Math.min(xMax, A.x + dx);
                tanData = [
                    { x: Math.pow(10, xL), y: eA + mTan * (xL - A.x) },
                    { x: Math.pow(10, xR), y: eA + mTan * (xR - A.x) }
                ];
            }

            let bisData = [];
            if (A && hasBis) {
                const u1 = { x: 1, y: 0 };
                const norm2 = Math.sqrt(1 + mTan * mTan);
                const u2 = { x: 1 / norm2, y: mTan / norm2 };
                const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
                // Allungata (era D.t*1.15/0.6): il minimo assoluto di 0.35 evita che
                // resti troppo corta quando D cade molto vicino ad A, mentre il
                // fattore 1.35 (invece di 1.15) la fa sporgere un po' di piu' oltre D
                // una volta trovato, cosi' la costruzione resta ben leggibile.
                const tEnd = D ? Math.max(D.t * 1.35, 0.35) : 0.9;
                bisData = [{ x: Math.pow(10, A.x), y: eA }, { x: Math.pow(10, A.x + bis.x * tEnd), y: eA + bis.y * tEnd }];
            }

            const pointAData = A ? [{ x: Math.pow(10, A.x), y: eA }] : [];
            const pointDData = D ? [{ x: D.sigma, y: D.e }] : [];

            if (chart) {
                chart.data.datasets[0].data = curveData;
                chart.data.datasets[1].data = rawData;
                chart.data.datasets[2].data = virginData;
                chart.data.datasets[3].data = horizData;
                chart.data.datasets[4].data = tanData;
                chart.data.datasets[5].data = bisData;
                chart.data.datasets[6].data = pointAData;
                chart.data.datasets[7].data = pointDData;
                chart.options.scales.x.min = xLeftEdge;
                chart.options.scales.x.max = xRightEdge;
                chart.options.scales.y.max = 1;
                chart.update('none');
                return;
            }

            const ctx = canvas.getContext('2d');
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        { label: "Curva e-log σ' (interpolata)", data: curveData, borderColor: '#1E507F', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0 },
                        { label: 'Punti di prova', data: rawData, borderColor: '#1E507F', backgroundColor: '#ffffff', borderWidth: 2, pointRadius: 4, showLine: false },
                        { label: 'Retta vergine (estesa)', data: virginData, borderColor: '#4a5568', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, tension: 0 },
                        { label: 'Orizzontale in A', data: horizData, borderColor: '#a0aec0', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0 },
                        { label: 'Tangente in A', data: tanData, borderColor: '#dd6b20', borderWidth: 2, pointRadius: 0, tension: 0 },
                        { label: 'Bisettrice', data: bisData, borderColor: '#805ad5', borderWidth: 2, pointRadius: 0, tension: 0 },
                        { label: 'Punto A', data: pointAData, borderColor: '#e53e3e', backgroundColor: '#e53e3e', pointRadius: 6, showLine: false },
                        { label: "Punto D (σ'p stimata)", data: pointDData, borderColor: '#38a169', backgroundColor: '#38a169', pointRadius: 6, pointStyle: 'rectRot', showLine: false }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { type: 'logarithmic', min: xLeftEdge, max: xRightEdge, title: { display: true, text: "σ' (kPa) — scala log" } },
                        // Il massimo dell'asse e resta fisso a 1 indipendentemente dai dati
                        // inseriti: cosi' e' solo la curva a spostarsi/cambiare forma quando
                        // si modificano i valori in tabella, non la scala del grafico.
                        y: { type: 'linear', max: 1, title: { display: true, text: 'Indice dei vuoti e' } }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 10 } } },
                        tooltip: {
                            callbacks: {
                                title: items => `σ' = ${parseFloat(items[0].parsed.x.toFixed(1))} kPa`,
                                label: item => `${item.dataset.label}: e = ${item.parsed.y.toFixed(3)}`
                            }
                        }
                    }
                }
            });
        }

        renderTable();
        recompute();
    }
    // ============================================================
    // Sotto-modulo B: cv, metodo di Casagrande (deformazione vs log t)
    // ============================================================
    function initCvCasagrandeTool() {
        const tbody = document.getElementById('cvc-table-body');
        const addRowBtn = document.getElementById('cvc-add-row');
        const hintOut = document.getElementById('cvc-hint');
        const drainDoubleBtn = document.getElementById('cvc-drain-double');
        const drainSingleBtn = document.getElementById('cvc-drain-single');
        const dOut = document.getElementById('cvc-d');
        const y100Out = document.getElementById('cvc-y100');
        const y0Out = document.getElementById('cvc-y0');
        const y50Out = document.getElementById('cvc-y50');
        const t50Out = document.getElementById('cvc-t50');
        const estOut = document.getElementById('cvc-est');

        const btnSuggest = document.getElementById('cvc-btn-suggest');
        const btnD0 = document.getElementById('cvc-btn-d0');
        const btnTanMid = document.getElementById('cvc-btn-tanmid');
        const btnTanTail = document.getElementById('cvc-btn-tantail');
        const btnD100 = document.getElementById('cvc-btn-d100');
        const btnD50 = document.getElementById('cvc-btn-d50');
        const btnReset = document.getElementById('cvc-btn-reset');

        let drainage = 'double';
        let chart = null;

        // Dati di partenza: lettura dello spessore campione H (mm) nel tempo t (min)
        // durante un gradino di carico di una prova edometrica (curva di Casagrande,
        // H-log t). I dati restano interamente modificabili dalla tabella.
        let points = [
            { t: 0.25, H: 15.66 },
            { t: 0.5, H: 15.61 },
            { t: 1, H: 15.52 },
            { t: 2.25, H: 15.40 },
            { t: 4, H: 15.27 },
            { t: 9, H: 15.00 },
            { t: 16, H: 14.74 },
            { t: 25, H: 14.48 },
            { t: 36, H: 14.27 },
            { t: 49, H: 14.14 },
            { t: 64, H: 14.05 },
            { t: 81, H: 13.99 },
            { t: 100, H: 13.95 },
            { t: 200, H: 13.83 },
            { t: 400, H: 13.75 },
            { t: 1440, H: 13.60 }
        ];

        // Stato della costruzione: c = punto scelto sul tratto iniziale (t1); il punto
        // d (t1/4) e' sempre derivato da c. Le tangenti e d100 sono indipendenti da c
        // (dipendono solo dalla forma della curva), come la retta vergine nel modulo
        // sigma'p: riposizionare c non le cancella, solo il Reset lo fa.
        let c = null;
        let hasD0 = false, hasTanMid = false, hasTanTail = false, hasD100 = false, hasD50 = false;

        function renderTable() {
            tbody.innerHTML = '';
            points.forEach((pt, idx) => {
                const tr = document.createElement('tr');

                const tdT = document.createElement('td');
                const inputT = document.createElement('input');
                inputT.type = 'number';
                inputT.step = 'any';
                inputT.min = '0';
                inputT.value = pt.t;
                inputT.addEventListener('input', () => {
                    points[idx].t = parseFloat(inputT.value);
                    recompute();
                });
                tdT.appendChild(inputT);

                const tdH = document.createElement('td');
                const inputH = document.createElement('input');
                inputH.type = 'number';
                inputH.step = 'any';
                inputH.min = '0';
                inputH.value = pt.H;
                inputH.addEventListener('input', () => {
                    points[idx].H = parseFloat(inputH.value);
                    recompute();
                });
                tdH.appendChild(inputH);

                const tdDel = document.createElement('td');
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'gran-remove-row';
                delBtn.innerHTML = '&times;';
                delBtn.title = 'Rimuovi punto';
                delBtn.addEventListener('click', () => {
                    points.splice(idx, 1);
                    renderTable();
                    recompute();
                });
                tdDel.appendChild(delBtn);

                tr.appendChild(tdT);
                tr.appendChild(tdH);
                tr.appendChild(tdDel);
                tbody.appendChild(tr);
            });
        }

        addRowBtn.addEventListener('click', () => {
            const last = points[points.length - 1];
            const newT = last ? Math.round(last.t * 2 * 100) / 100 : 1;
            const newH = last ? last.H : 15;
            points.push({ t: newT, H: newH });
            renderTable();
            recompute();
        });

        drainDoubleBtn.addEventListener('click', () => {
            drainage = 'double';
            drainDoubleBtn.classList.add('active');
            drainSingleBtn.classList.remove('active');
            recompute();
        });
        drainSingleBtn.addEventListener('click', () => {
            drainage = 'single';
            drainSingleBtn.classList.add('active');
            drainDoubleBtn.classList.remove('active');
            recompute();
        });

        // --- Spline cubica monotona di Hermite (Fritsch-Carlson) su (log10 t, H) ---
        function buildSpline(pts) {
            const n = pts.length;
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            if (n < 2) return null;
            const d = [];
            for (let i = 0; i < n - 1; i++) {
                const h = xs[i + 1] - xs[i];
                d.push(h !== 0 ? (ys[i + 1] - ys[i]) / h : 0);
            }
            const m = new Array(n);
            m[0] = d[0];
            m[n - 1] = d[n - 2];
            for (let i = 1; i < n - 1; i++) {
                if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] > 0) !== (d[i] > 0)) {
                    m[i] = 0;
                } else {
                    m[i] = (d[i - 1] + d[i]) / 2;
                }
            }
            for (let i = 0; i < n - 1; i++) {
                if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
                const a = m[i] / d[i], b = m[i + 1] / d[i];
                const s = a * a + b * b;
                if (s > 9) {
                    const tau = 3 / Math.sqrt(s);
                    m[i] = tau * a * d[i];
                    m[i + 1] = tau * b * d[i];
                }
            }
            return { xs, ys, m };
        }

        function splineEval(sp, x) {
            const { xs, ys, m } = sp;
            const n = xs.length;
            if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
            if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
            let i = 0;
            while (i < n - 2 && x > xs[i + 1]) i++;
            const h = xs[i + 1] - xs[i];
            const t = (x - xs[i]) / h;
            const t2 = t * t, t3 = t2 * t;
            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + t;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;
            return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
        }

        function splineSlope(sp, x) {
            const h = 0.005;
            return (splineEval(sp, x + h) - splineEval(sp, x - h)) / (2 * h);
        }

        // Arrotonda i confini dell'asse t (scala log) ai valori "puliti" 1-2-5 x 10^n
        // piu' vicini, come nel modulo sigma'p.
        function niceFloor(v) {
            const exp = Math.floor(Math.log10(v));
            const base = Math.pow(10, exp);
            let best = base;
            [1, 2, 5, 10].forEach(mult => { if (mult * base <= v + 1e-9) best = mult * base; });
            return best;
        }
        function niceCeil(v) {
            const exp = Math.floor(Math.log10(v));
            const base = Math.pow(10, exp);
            const candidates = [1, 2, 5, 10].map(mult => mult * base);
            for (const cc of candidates) if (cc >= v - 1e-9) return cc;
            return candidates[candidates.length - 1];
        }

        // Passo "tondo" (1/2/5 * 10^n) per l'asse y, cosi' il fondo scala
        // (min/max) puo' essere allineato a un multiplo esatto del passo:
        // se il passo e' 0.5 il fondo scala e' sempre .0 o .5, mai un valore
        // arbitrario come 13.65.
        function niceStep(range, targetTicks) {
            targetTicks = targetTicks || 5;
            if (!(range > 0)) return 1;
            const roughStep = range / targetTicks;
            const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
            const norm = roughStep / mag;
            let niceNorm;
            if (norm < 1.5) niceNorm = 1;
            else if (norm < 3) niceNorm = 2;
            else if (norm < 7) niceNorm = 5;
            else niceNorm = 10;
            return niceNorm * mag;
        }

        // Interpolazione inversa su punti {x,y} ordinati per x crescente e y
        // monotona NON crescente (il caso di interpX condiviso assume invece y
        // crescente, qui H diminuisce nel tempo).
        function interpXDecreasing(pts, yTarget) {
            if (yTarget >= pts[0].y) return pts[0].x;
            const last = pts[pts.length - 1];
            if (yTarget <= last.y) return last.x;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[i], p1 = pts[i + 1];
                if (yTarget <= p0.y && yTarget >= p1.y) {
                    if (p1.y === p0.y) return p0.x;
                    const f = (p0.y - yTarget) / (p0.y - p1.y);
                    return p0.x + f * (p1.x - p0.x);
                }
            }
            return last.x;
        }

        function validPoints() {
            const raw = points
                .map(pt => ({ x: Math.log10(parseFloat(pt.t)), y: parseFloat(pt.H), t: parseFloat(pt.t), H: parseFloat(pt.H) }))
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y) && pt.t > 0)
                .sort((a, b) => a.x - b.x);
            const out = [];
            raw.forEach(pt => {
                if (out.length && Math.abs(out[out.length - 1].x - pt.x) < 1e-9) {
                    out[out.length - 1] = pt;
                } else {
                    out.push(pt);
                }
            });
            return out;
        }

        function updateButtons(vp) {
            const enough = vp.length >= 2;
            btnSuggest.disabled = vp.length < 3;
            btnD0.disabled = !(enough && c);
            btnTanMid.disabled = !enough;
            btnTanTail.disabled = !(enough && hasTanMid);
            btnD100.disabled = !(hasTanMid && hasTanTail);
            btnD50.disabled = !(hasD0 && hasD100);
            btnReset.disabled = !(c || hasTanMid);
        }

        function updateHint(vp) {
            if (vp.length < 2) {
                hintOut.textContent = 'Inserisci almeno due punti (t, H) validi per tracciare la curva.';
                hintOut.className = 'sif-status sif-status-critical';
            } else if (!c) {
                hintOut.textContent = 'Passo 1: clicca sul grafico per posizionare il punto c.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasD0) {
                hintOut.textContent = 'Passo 2: costruisci d0 (punti c e d).';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasTanMid) {
                hintOut.textContent = 'Passo 3: tangente al tratto centrale.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasTanTail) {
                hintOut.textContent = 'Passo 4: tangente al tratto finale.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasD100) {
                hintOut.textContent = 'Passo 5: trova d100.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasD50) {
                hintOut.textContent = 'Passo 6: trova t50 e calcola cv.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else {
                hintOut.textContent = 'Costruzione completata: cv è calcolato da d e da t50.';
                hintOut.className = 'sif-status sif-status-ok';
            }
        }

        btnSuggest.addEventListener('click', () => {
            const vp = validPoints();
            if (vp.length < 3) return;
            const sp = buildSpline(vp);
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            const NS = 200;
            let inflIdx = 1, maxAbsSlope = -Infinity;
            for (let i = 1; i < NS; i++) {
                const x = xMin + (xMax - xMin) * i / NS;
                const s = Math.abs(splineSlope(sp, x));
                if (s > maxAbsSlope) { maxAbsSlope = s; inflIdx = i; }
            }
            const inflX = xMin + (xMax - xMin) * inflIdx / NS;
            const minX1 = xMin + Math.log10(4) + 0.05;
            let x1 = xMin + 0.55 * (inflX - xMin);
            x1 = Math.max(minX1, Math.min(x1, xMax));
            c = { x: x1 };
            hasD0 = false;
            hasD50 = false;
            updateButtons(vp);
            recompute();
        });

        btnD0.addEventListener('click', () => {
            if (!c) return;
            hasD0 = true;
            updateButtons(validPoints());
            recompute();
        });

        btnTanMid.addEventListener('click', () => {
            hasTanMid = true;
            updateButtons(validPoints());
            recompute();
        });

        btnTanTail.addEventListener('click', () => {
            if (!hasTanMid) return;
            hasTanTail = true;
            updateButtons(validPoints());
            recompute();
        });

        btnD100.addEventListener('click', () => {
            if (!hasTanMid || !hasTanTail) return;
            hasD100 = true;
            updateButtons(validPoints());
            recompute();
        });

        btnD50.addEventListener('click', () => {
            if (!hasD0 || !hasD100) return;
            hasD50 = true;
            updateButtons(validPoints());
            recompute();
        });

        btnReset.addEventListener('click', () => {
            c = null;
            hasD0 = false;
            hasTanMid = false;
            hasTanTail = false;
            hasD100 = false;
            hasD50 = false;
            updateButtons(validPoints());
            recompute();
        });

        // --- Selezione del punto c: clic direttamente sul grafico, sul tratto iniziale ---
        const canvas = document.getElementById('cvCasagrandeChart');
        canvas.addEventListener('click', (evt) => {
            const vp = validPoints();
            if (vp.length < 2 || !chart) return;
            const rect = canvas.getBoundingClientRect();
            const xPix = evt.clientX - rect.left;
            const scaleX = chart.scales && chart.scales.x;
            if (!scaleX || typeof scaleX.getValueForPixel !== 'function') return;
            const tClick = scaleX.getValueForPixel(xPix);
            if (!Number.isFinite(tClick) || tClick <= 0) return;
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            const minX1 = xMin + Math.log10(4) + 0.02;
            let xLog = Math.log10(tClick);
            xLog = Math.min(Math.max(xLog, minX1), xMax);
            c = { x: xLog };
            hasD0 = false;
            hasD50 = false;
            updateButtons(vp);
            recompute();
        });

        function recompute() {
            const vp = validPoints();
            updateButtons(vp);
            updateHint(vp);

            if (vp.length < 2) {
                if (chart) { chart.destroy(); chart = null; }
                dOut.textContent = '—';
                y0Out.textContent = '—';
                y100Out.textContent = '—';
                y50Out.textContent = '—';
                t50Out.textContent = '—';
                estOut.textContent = '—';
                return;
            }

            const sp = buildSpline(vp);
            const tMin = vp[0].t, tMax = vp[vp.length - 1].t;
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            const xLeftEdge = niceFloor(tMin);
            const xRightEdge = niceCeil(tMax);
            const xLeftEdgeLog = Math.log10(xLeftEdge), xRightEdgeLog = Math.log10(xRightEdge);

            const N = 150;
            const curveData = [];
            for (let i = 0; i <= N; i++) {
                const x = xMin + (xMax - xMin) * i / N;
                curveData.push({ x: Math.pow(10, x), y: splineEval(sp, x) });
            }
            const rawData = vp.map(p => ({ x: p.t, y: p.H }));

            // Percorso di drenaggio: usa lo spessore medio del campione durante il
            // gradino (media fra la prima e l'ultima lettura della tabella).
            const Hm = (vp[0].H + vp[vp.length - 1].H) / 2;
            const d = (drainage === 'double' ? Hm / 2 : Hm) / 10; // mm -> cm
            dOut.textContent = d.toFixed(3) + ' cm';

            // Punto di flesso (tangente al tratto centrale): massima pendenza assoluta
            let inflIdx = 1, maxAbsSlope = -Infinity, inflSlope = 0;
            for (let i = 1; i < N; i++) {
                const x = xMin + (xMax - xMin) * i / N;
                const s = splineSlope(sp, x);
                if (Math.abs(s) > maxAbsSlope) { maxAbsSlope = Math.abs(s); inflIdx = i; inflSlope = s; }
            }
            const inflX = xMin + (xMax - xMin) * inflIdx / N;
            const inflY = splineEval(sp, inflX);

            // Tangente al tratto finale (ultimo 20% del dominio in log t)
            const tailXStart = xMax - 0.2 * (xMax - xMin);
            const tailPts = [];
            for (let i = 0; i <= N; i++) {
                const x = xMin + (xMax - xMin) * i / N;
                if (x >= tailXStart) tailPts.push({ x, y: splineEval(sp, x) });
            }
            const tailFit = linreg(tailPts.length >= 2 ? tailPts : [
                { x: xMax - 0.01, y: splineEval(sp, xMax - 0.01) },
                { x: xMax, y: splineEval(sp, xMax) }
            ]);

            let tanMidData = [], tanTailData = [], d100 = null, pointD100 = [];
            if (hasTanMid) {
                // La tangente al flesso si disegna per l'intera larghezza del
                // grafico (bordo sinistro-bordo destro dell'asse), come nella
                // costruzione classica di Casagrande: cosi' resta ben visibile
                // anche dove si allontana dalla curva.
                const xL = xLeftEdgeLog, xR = xRightEdgeLog;
                tanMidData = [
                    { x: Math.pow(10, xL), y: inflY + inflSlope * (xL - inflX) },
                    { x: Math.pow(10, xR), y: inflY + inflSlope * (xR - inflX) }
                ];
            }
            if (hasTanTail) {
                // Stessa idea: la tangente al tratto finale attraversa tutto il
                // grafico, non solo l'ultimo tratto su cui e' stata calcolata.
                const xL = xLeftEdgeLog, xR = xRightEdgeLog;
                tanTailData = [
                    { x: Math.pow(10, xL), y: tailFit.intercept + tailFit.slope * xL },
                    { x: Math.pow(10, xR), y: tailFit.intercept + tailFit.slope * xR }
                ];
            }
            if (hasD100 && hasTanMid && hasTanTail) {
                const P = lineIntersect({ x: inflX, y: inflY }, { x: 1, y: inflSlope }, { x: 0, y: tailFit.intercept }, { x: 1, y: tailFit.slope });
                if (P) { d100 = P.y; pointD100 = [{ x: Math.pow(10, P.x), y: P.y }]; }
            }

            let cData = [], dData = [], d0 = null, line0Data = [];
            if (c) {
                const Hc = splineEval(sp, c.x);
                const xD = c.x - Math.log10(4);
                const Hd = splineEval(sp, xD);
                cData = [{ x: Math.pow(10, c.x), y: Hc }];
                dData = [{ x: Math.pow(10, xD), y: Hd }];
                if (hasD0) {
                    d0 = 2 * Hd - Hc;
                    // Le rette di costruzione partono dal bordo sinistro del
                    // grafico (l'asse y), non dal primo punto dati: cosi'
                    // toccano davvero l'asse invece di restare "sospese".
                    line0Data = [{ x: xLeftEdge, y: d0 }, { x: tMax, y: d0 }];
                }
            }

            let line100Data = [];
            if (d100 !== null) {
                line100Data = [{ x: xLeftEdge, y: d100 }, { x: tMax, y: d100 }];
            }

            let d50 = null, t50 = null, line50Data = [], point50 = [];
            if (hasD50 && d0 !== null && d100 !== null) {
                d50 = (d0 + d100) / 2;
                t50 = Math.pow(10, interpXDecreasing(curveData.map(p => ({ x: Math.log10(p.x), y: p.y })), d50));
                line50Data = [{ x: xLeftEdge, y: d50 }, { x: t50, y: d50 }];
                point50 = [{ x: t50, y: d50 }];
            }

            y0Out.textContent = d0 !== null ? d0.toFixed(3) + ' mm' : '—';
            y100Out.textContent = d100 !== null ? d100.toFixed(3) + ' mm' : '—';
            y50Out.textContent = d50 !== null ? d50.toFixed(3) + ' mm' : '—';
            t50Out.textContent = t50 !== null ? t50.toFixed(2) + ' min' : '—';
            if (t50 !== null && t50 > 0) {
                const cvEst = 0.196 * d * d / t50;
                estOut.textContent = formatCvM2S(cvEst);
            } else {
                estOut.textContent = '—';
            }

            const allYs = vp.map(p => p.H);
            if (d0 !== null) allYs.push(d0);
            if (d100 !== null) allYs.push(d100);
            const yMinData = Math.min(...allYs), yMaxData = Math.max(...allYs);
            const yPad = Math.max(0.15, (yMaxData - yMinData) * 0.1);
            // Il passo dei tick e' "tondo" (1/2/5 * 10^n): il fondo scala
            // (min e max) e' allineato a un multiplo esatto di quel passo,
            // cosi' l'asse finisce sempre su un valore "intero" rispetto
            // alla griglia (es. passo 0.5 => fondo scala .0 o .5), mai un
            // numero arbitrario.
            const yStep = niceStep((yMaxData + yPad) - (yMinData - yPad));
            let yAxisMin = Math.floor((yMinData - yPad) / yStep) * yStep;
            let yAxisMax = Math.ceil((yMaxData + yPad) / yStep) * yStep;
            if (yAxisMin >= yMinData - 1e-9) yAxisMin -= yStep;
            if (yAxisMax <= yMaxData + 1e-9) yAxisMax += yStep;
            // Griglia orizzontale a due livelli: una linea "maggiore" ad ogni
            // yStep (piu' marcata, con etichetta) e una "minore" ogni 0.1 mm
            // (passo fisso, non a meta' passo maggiore), piu' leggera e
            // senza etichetta.
            const yMinorStep = yStep > 0.1 ? 0.1 : yStep / 2;
            const yTicksConfig = {
                stepSize: yMinorStep,
                // Di default Chart.js limita il numero di tick (maxTicksLimit
                // = 11) e, se lo stepSize dato ne genererebbe di piu', lo
                // ignora silenziosamente scegliendone uno piu' largo: con un
                // passo minore fisso a 0.1 servono spesso piu' di 11 tick,
                // quindi il limite va alzato per non perdere la griglia fine.
                maxTicksLimit: Math.ceil((yAxisMax - yAxisMin) / yMinorStep) + 2,
                // "autoSkip" di norma dirada i tick per non affollare l'asse
                // di etichette: lo fa PRIMA di sapere che le etichette dei
                // tick minori sono vuote, quindi finirebbe comunque per
                // scartarne meta' (passo 0.1 -> 0.2). Va disattivato per
                // ottenere davvero tutte le linee della griglia a 0.1.
                autoSkip: false,
                callback: function (value) {
                    const ratio = (value - yAxisMin) / yStep;
                    const isMajor = Math.abs(ratio - Math.round(ratio)) < 1e-6;
                    return isMajor ? Math.round(value * 100) / 100 : '';
                }
            };
            const yGridConfig = {
                color: function (context) {
                    const value = context && context.tick ? context.tick.value : null;
                    if (value === null) return 'rgba(160, 174, 192, 0.5)';
                    const ratio = (value - yAxisMin) / yStep;
                    const isMajor = Math.abs(ratio - Math.round(ratio)) < 1e-6;
                    return isMajor ? 'rgba(160, 174, 192, 0.55)' : 'rgba(160, 174, 192, 0.3)';
                }
            };

            if (chart) {
                chart.data.datasets[0].data = curveData;
                chart.data.datasets[1].data = rawData;
                chart.data.datasets[2].data = cData;
                chart.data.datasets[3].data = dData;
                chart.data.datasets[4].data = line0Data;
                chart.data.datasets[5].data = tanMidData;
                chart.data.datasets[6].data = tanTailData;
                chart.data.datasets[7].data = line100Data;
                chart.data.datasets[8].data = pointD100;
                chart.data.datasets[9].data = line50Data;
                chart.data.datasets[10].data = point50;
                chart.options.scales.x.min = xLeftEdge;
                chart.options.scales.x.max = xRightEdge;
                chart.options.scales.y.min = yAxisMin;
                chart.options.scales.y.max = yAxisMax;
                chart.options.scales.y.ticks = yTicksConfig;
                chart.options.scales.y.grid = yGridConfig;
                chart.update('none');
                return;
            }

            const ctx = canvas.getContext('2d');
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        { label: 'Curva H-log t (interpolata)', data: curveData, borderColor: '#1E507F', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0 },
                        { label: 'Punti di prova', data: rawData, borderColor: '#1E507F', backgroundColor: '#ffffff', borderWidth: 2, pointRadius: 4, showLine: false },
                        { label: 'Punto c (t₁)', data: cData, borderColor: '#e53e3e', backgroundColor: '#e53e3e', pointRadius: 6, showLine: false },
                        { label: 'Punto d (t₁÷4)', data: dData, borderColor: '#4a5568', backgroundColor: '#4a5568', pointRadius: 5, showLine: false },
                        { label: 'd₀ (costruzione t₁/t₁÷4)', data: line0Data, borderColor: '#a0aec0', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0 },
                        { label: 'Tangente al tratto centrale', data: tanMidData, borderColor: '#dd6b20', borderWidth: 2, pointRadius: 0, tension: 0 },
                        { label: 'Tangente al tratto finale', data: tanTailData, borderColor: '#4a5568', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, tension: 0 },
                        { label: 'd₁₀₀ (intersezione tangenti)', data: line100Data, borderColor: '#a0aec0', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0 },
                        { label: 'Punto d₁₀₀', data: pointD100, borderColor: '#38a169', backgroundColor: '#38a169', pointRadius: 6, pointStyle: 'rectRot', showLine: false },
                        { label: 'd₅₀', data: line50Data, borderColor: '#38a169', borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0, tension: 0 },
                        { label: 't₅₀', data: point50, borderColor: '#38a169', backgroundColor: '#38a169', pointRadius: 6, pointStyle: 'star', showLine: false }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { type: 'logarithmic', min: xLeftEdge, max: xRightEdge, title: { display: true, text: 'Tempo t (min) — scala log' } },
                        y: { type: 'linear', min: yAxisMin, max: yAxisMax, title: { display: true, text: 'H (mm)' }, ticks: yTicksConfig, grid: yGridConfig }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 10 } } },
                        tooltip: {
                            callbacks: {
                                title: items => `t = ${parseFloat(items[0].parsed.x.toFixed(2))} min`,
                                label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(3)} mm`
                            }
                        }
                    }
                }
            });
        }

        renderTable();
        recompute();
    }

    // ============================================================
    // Sotto-modulo C: cv, metodo di Taylor (deformazione vs radice di t)
    // ============================================================
    function initCvTaylorTool() {
        const tbody = document.getElementById('cvt-table-body');
        const addRowBtn = document.getElementById('cvt-add-row');
        const hintOut = document.getElementById('cvt-hint');
        const hInput = document.getElementById('cvt-H');
        const drainDoubleBtn = document.getElementById('cvt-drain-double');
        const drainSingleBtn = document.getElementById('cvt-drain-single');
        const dOut = document.getElementById('cvt-d');
        const c0Out = document.getElementById('cvt-c0');
        const m0Out = document.getElementById('cvt-m0');
        const d90Out = document.getElementById('cvt-d90');
        const d100Out = document.getElementById('cvt-d100');
        const t90Out = document.getElementById('cvt-t90');
        const estOut = document.getElementById('cvt-est');

        const btnSuggest = document.getElementById('cvt-btn-suggest');
        const btnAB = document.getElementById('cvt-btn-ab');
        const btnAC = document.getElementById('cvt-btn-ac');
        const btnD90 = document.getElementById('cvt-btn-d90');
        const btnReset = document.getElementById('cvt-btn-reset');

        let drainage = 'double';
        let chart = null;

        // Dati di partenza: lettura di deformazione (mm, crescente) nel tempo t (min)
        // durante un gradino di carico edometrico, pensati per il metodo di Taylor
        // (retta AB sul tratto iniziale, retta AC a 1.15x). Interamente modificabili
        // dalla tabella. Lo spessore campione H e' un valore a parte (serve solo per
        // il percorso di drenaggio d), non fa parte della curva di deformazione.
        let points = [
            { t: 0.25, def: 2.04 },
            { t: 0.5, def: 2.82 },
            { t: 1, def: 3.89 },
            { t: 2, def: 5.13 },
            { t: 4, def: 6.02 },
            { t: 6, def: 6.25 },
            { t: 9, def: 6.33 },
            { t: 12, def: 6.36 },
            { t: 16, def: 6.38 },
            { t: 20, def: 6.40 },
            { t: 25, def: 6.42 },
            { t: 36, def: 6.46 },
            { t: 49, def: 6.49 },
            { t: 64, def: 6.51 }
        ];

        // Stato della costruzione: bEnd = ascissa (radice di t) scelta come fine del
        // tratto iniziale rettilineo, usata per la retta AB. Le fasi successive sono
        // indipendenti l'una dall'altra una volta costruite (come in sigma'p/Casagrande):
        // solo il Reset le cancella tutte.
        let bEnd = null;
        let hasAB = false, hasAC = false, hasD90 = false;

        function renderTable() {
            tbody.innerHTML = '';
            points.forEach((pt, idx) => {
                const tr = document.createElement('tr');

                const tdT = document.createElement('td');
                const inputT = document.createElement('input');
                inputT.type = 'number';
                inputT.step = 'any';
                inputT.min = '0';
                inputT.value = pt.t;
                inputT.addEventListener('input', () => {
                    points[idx].t = parseFloat(inputT.value);
                    recompute();
                });
                tdT.appendChild(inputT);

                const tdDef = document.createElement('td');
                const inputDef = document.createElement('input');
                inputDef.type = 'number';
                inputDef.step = 'any';
                inputDef.value = pt.def;
                inputDef.addEventListener('input', () => {
                    points[idx].def = parseFloat(inputDef.value);
                    recompute();
                });
                tdDef.appendChild(inputDef);

                const tdDel = document.createElement('td');
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'gran-remove-row';
                delBtn.innerHTML = '&times;';
                delBtn.title = 'Rimuovi punto';
                delBtn.addEventListener('click', () => {
                    points.splice(idx, 1);
                    renderTable();
                    recompute();
                });
                tdDel.appendChild(delBtn);

                tr.appendChild(tdT);
                tr.appendChild(tdDef);
                tr.appendChild(tdDel);
                tbody.appendChild(tr);
            });
        }

        addRowBtn.addEventListener('click', () => {
            const last = points[points.length - 1];
            const newT = last ? Math.round(last.t * 1.5 * 100) / 100 : 1;
            const newDef = last ? last.def : 0;
            points.push({ t: newT, def: newDef });
            renderTable();
            recompute();
        });

        hInput.addEventListener('input', recompute);

        drainDoubleBtn.addEventListener('click', () => {
            drainage = 'double';
            drainDoubleBtn.classList.add('active');
            drainSingleBtn.classList.remove('active');
            recompute();
        });
        drainSingleBtn.addEventListener('click', () => {
            drainage = 'single';
            drainSingleBtn.classList.add('active');
            drainDoubleBtn.classList.remove('active');
            recompute();
        });

        // --- Spline cubica monotona di Hermite (Fritsch-Carlson) su (sqrt(t), deformazione) ---
        function buildSpline(pts) {
            const n = pts.length;
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            if (n < 2) return null;
            const d = [];
            for (let i = 0; i < n - 1; i++) {
                const h = xs[i + 1] - xs[i];
                d.push(h !== 0 ? (ys[i + 1] - ys[i]) / h : 0);
            }
            const m = new Array(n);
            m[0] = d[0];
            m[n - 1] = d[n - 2];
            for (let i = 1; i < n - 1; i++) {
                if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] > 0) !== (d[i] > 0)) {
                    m[i] = 0;
                } else {
                    m[i] = (d[i - 1] + d[i]) / 2;
                }
            }
            for (let i = 0; i < n - 1; i++) {
                if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
                const a = m[i] / d[i], b = m[i + 1] / d[i];
                const s = a * a + b * b;
                if (s > 9) {
                    const tau = 3 / Math.sqrt(s);
                    m[i] = tau * a * d[i];
                    m[i + 1] = tau * b * d[i];
                }
            }
            return { xs, ys, m };
        }

        function splineEval(sp, x) {
            const { xs, ys, m } = sp;
            const n = xs.length;
            if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
            if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
            let i = 0;
            while (i < n - 2 && x > xs[i + 1]) i++;
            const h = xs[i + 1] - xs[i];
            const t = (x - xs[i]) / h;
            const t2 = t * t, t3 = t2 * t;
            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + t;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;
            return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
        }

        function splineSlope(sp, x) {
            const h = 0.005;
            return (splineEval(sp, x + h) - splineEval(sp, x - h)) / (2 * h);
        }

        // Passo "tondo" (1/2/5 * 10^n), riusato sia per l'asse y (deformazione) sia
        // per stimare un bordo destro pulito dell'asse x (radice di t).
        function niceStep(range, targetTicks) {
            targetTicks = targetTicks || 5;
            if (!(range > 0)) return 1;
            const roughStep = range / targetTicks;
            const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
            const norm = roughStep / mag;
            let niceNorm;
            if (norm < 1.5) niceNorm = 1;
            else if (norm < 3) niceNorm = 2;
            else if (norm < 7) niceNorm = 5;
            else niceNorm = 10;
            return niceNorm * mag;
        }

        function validPoints() {
            const raw = points
                .map(pt => ({ x: Math.sqrt(parseFloat(pt.t)), y: parseFloat(pt.def), t: parseFloat(pt.t), def: parseFloat(pt.def) }))
                .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y) && pt.t >= 0)
                .sort((a, b) => a.x - b.x);
            const out = [];
            raw.forEach(pt => {
                if (out.length && Math.abs(out[out.length - 1].x - pt.x) < 1e-9) {
                    out[out.length - 1] = pt;
                } else {
                    out.push(pt);
                }
            });
            return out;
        }

        function updateButtons(vp) {
            const enough = vp.length >= 2;
            btnSuggest.disabled = vp.length < 3;
            btnAB.disabled = !(enough && bEnd !== null);
            btnAC.disabled = !hasAB;
            btnD90.disabled = !hasAC;
            btnReset.disabled = !(bEnd !== null || hasAB);
        }

        function updateHint(vp) {
            if (vp.length < 2) {
                hintOut.textContent = 'Inserisci almeno due punti (t, deformazione) validi per tracciare la curva.';
                hintOut.className = 'sif-status sif-status-critical';
            } else if (bEnd === null) {
                hintOut.textContent = "Passo 1: clicca sul grafico per scegliere la fine del tratto iniziale.";
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasAB) {
                hintOut.textContent = 'Passo 2: costruisci la retta AB.';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasAC) {
                hintOut.textContent = 'Passo 3: costruisci la retta AC (1.15×AB).';
                hintOut.className = 'sif-status sif-status-neutral';
            } else if (!hasD90) {
                hintOut.textContent = 'Passo 4: trova il punto C, intersezione fra AC e la curva (dà t90 e cv).';
                hintOut.className = 'sif-status sif-status-neutral';
            } else {
                hintOut.textContent = 'Costruzione completata: cv è calcolato da d e da t90.';
                hintOut.className = 'sif-status sif-status-ok';
            }
        }

        btnSuggest.addEventListener('click', () => {
            const vp = validPoints();
            if (vp.length < 3) return;
            const sp = buildSpline(vp);
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            if (!(xMax > xMin)) return;
            const probe = xMin + Math.max((xMax - xMin) * 0.02, 0.01);
            const slopeStart = splineSlope(sp, probe);
            let picked = xMax;
            const steps = 200;
            for (let i = 1; i <= steps; i++) {
                const x = xMin + (xMax - xMin) * i / steps;
                if (splineSlope(sp, x) < 0.7 * slopeStart) { picked = x; break; }
            }
            bEnd = Math.max(picked, xMin + 0.02);
            hasAB = false; hasAC = false; hasD90 = false;
            updateButtons(vp);
            recompute();
        });

        btnAB.addEventListener('click', () => {
            if (bEnd === null) return;
            hasAB = true;
            updateButtons(validPoints());
            recompute();
        });
        btnAC.addEventListener('click', () => {
            if (!hasAB) return;
            hasAC = true;
            updateButtons(validPoints());
            recompute();
        });
        btnD90.addEventListener('click', () => {
            if (!hasAC) return;
            hasD90 = true;
            updateButtons(validPoints());
            recompute();
        });
        btnReset.addEventListener('click', () => {
            bEnd = null;
            hasAB = false; hasAC = false; hasD90 = false;
            updateButtons(validPoints());
            recompute();
        });

        // --- Selezione della fine del tratto iniziale: clic diretto sul grafico ---
        const canvas = document.getElementById('cvTaylorChart');
        canvas.addEventListener('click', (evt) => {
            const vp = validPoints();
            if (vp.length < 2 || !chart) return;
            const rect = canvas.getBoundingClientRect();
            const xPix = evt.clientX - rect.left;
            const scaleX = chart.scales && chart.scales.x;
            if (!scaleX || typeof scaleX.getValueForPixel !== 'function') return;
            const sqClick = scaleX.getValueForPixel(xPix);
            if (!Number.isFinite(sqClick)) return;
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;
            const upper = xMax - 0.02 > xMin ? xMax - 0.02 : xMax;
            bEnd = Math.min(Math.max(sqClick, xMin + 0.02), upper);
            hasAB = false; hasAC = false; hasD90 = false;
            updateButtons(vp);
            recompute();
        });

        function recompute() {
            const vp = validPoints();
            updateButtons(vp);
            updateHint(vp);

            if (vp.length < 2) {
                if (chart) { chart.destroy(); chart = null; }
                dOut.textContent = '—';
                c0Out.textContent = '—';
                m0Out.textContent = '—';
                d90Out.textContent = '—';
                d100Out.textContent = '—';
                t90Out.textContent = '—';
                estOut.textContent = '—';
                return;
            }

            const sp = buildSpline(vp);
            const xMin = vp[0].x, xMax = vp[vp.length - 1].x;

            const N = 150;
            const curveData = [];
            for (let i = 0; i <= N; i++) {
                const x = xMin + (xMax - xMin) * i / N;
                curveData.push({ x, y: splineEval(sp, x) });
            }
            const rawData = vp.map(p => ({ x: p.x, y: p.y }));

            const H = parseFloat(hInput.value);
            const Hval = Number.isFinite(H) && H > 0 ? H : 20;
            const d = (drainage === 'double' ? Hval / 2 : Hval) / 10; // mm -> cm
            dOut.textContent = d.toFixed(3) + ' cm';

            const xStep = niceStep(xMax - xMin > 0 ? xMax - xMin : 1);
            const xRightEdge = Math.ceil((xMax * 1.05) / xStep) * xStep;

            let pointB = [];
            if (bEnd !== null) {
                pointB = [{ x: bEnd, y: splineEval(sp, bEnd) }];
            }

            let c0 = null, m0 = null, lineABData = [];
            if (hasAB && bEnd !== null) {
                let fitPts = vp.filter(p => p.x <= bEnd + 1e-9).map(p => ({ x: p.x, y: p.y }));
                if (fitPts.length < 2) fitPts = vp.slice(0, 2).map(p => ({ x: p.x, y: p.y }));
                const fit = linreg(fitPts);
                c0 = fit.intercept;
                m0 = fit.slope;
                lineABData = [{ x: 0, y: c0 }, { x: xRightEdge, y: c0 + m0 * xRightEdge }];
            }

            let mAC = null, lineACData = [];
            let xAux = null, yAux = null, xAuxC = null;
            if (hasAC && c0 !== null && m0 !== null) {
                mAC = m0 / 1.15;
                lineACData = [{ x: 0, y: c0 }, { x: xRightEdge, y: c0 + mAC * xRightEdge }];
                // Costruzione ausiliaria "riga e squadra" della retta AC: si sceglie
                // un'ascissa comoda (qui bEnd), si sale fino alla retta AB (punto B),
                // si traccia l'orizzontale per B e si riporta 1.15 volte la distanza
                // dall'asse y per ottenere il punto sulla retta AC alla stessa quota.
                xAux = bEnd;
                yAux = c0 + m0 * xAux;
                xAuxC = 1.15 * xAux;
            }

            let sq90 = null, y90 = null, pointD90Data = [];
            if (hasD90 && mAC !== null) {
                let crossIdx = -1;
                for (let i = 1; i < curveData.length; i++) {
                    const diffPrev = curveData[i - 1].y - (c0 + mAC * curveData[i - 1].x);
                    const diffCur = curveData[i].y - (c0 + mAC * curveData[i].x);
                    if (diffPrev >= 0 && diffCur < 0) { crossIdx = i; break; }
                }
                if (crossIdx >= 1) {
                    const p0 = curveData[crossIdx - 1], p1 = curveData[crossIdx];
                    const dd0 = p0.y - (c0 + mAC * p0.x);
                    const dd1 = p1.y - (c0 + mAC * p1.x);
                    const f = dd0 / (dd0 - dd1);
                    sq90 = p0.x + f * (p1.x - p0.x);
                    y90 = c0 + mAC * sq90;
                } else {
                    sq90 = curveData[curveData.length - 1].x;
                    y90 = curveData[curveData.length - 1].y;
                }
                pointD90Data = [{ x: sq90, y: y90 }];
            }

            let t90 = null, cvEst = null;
            if (hasD90 && sq90 !== null) {
                t90 = sq90 * sq90;
                cvEst = t90 > 0 ? 0.848 * d * d / t90 : null;
            }

            // U=100% (fine della consolidazione primaria), per proporzione:
            // DeltaH100 = (10/9) * DeltaH90, misurate a partire da D0 (punto A).
            let d100 = null;
            if (y90 !== null && c0 !== null) {
                d100 = c0 + (10 / 9) * (y90 - c0);
            }

            let pointA0 = [];
            if (c0 !== null) pointA0 = [{ x: 0, y: c0 }];

            c0Out.textContent = c0 !== null ? c0.toFixed(3) + ' mm' : '—';
            m0Out.textContent = m0 !== null ? m0.toFixed(4) + ' mm/√min' : '—';
            d90Out.textContent = y90 !== null ? y90.toFixed(3) + ' mm' : '—';
            d100Out.textContent = d100 !== null ? d100.toFixed(3) + ' mm' : '—';
            t90Out.textContent = t90 !== null ? t90.toFixed(2) + ' min' : '—';
            estOut.textContent = cvEst !== null ? formatCvM2S(cvEst) : '—';

            // Fondo scala "tondo" per l'asse y (deformazione), con griglia a due
            // livelli (principale ogni yStep, secondaria fissa ogni 0.1 mm), come
            // nel modulo cv-Casagrande.
            const allYs = vp.map(p => p.y);
            if (c0 !== null) allYs.push(c0);
            if (y90 !== null) allYs.push(y90);
            const yMinData = Math.min(...allYs), yMaxData = Math.max(...allYs);
            const yPad = Math.max(0.15, (yMaxData - yMinData) * 0.1);
            const yStep = niceStep((yMaxData + yPad) - (yMinData - yPad));
            let yAxisMin = Math.floor((yMinData - yPad) / yStep) * yStep;
            let yAxisMax = Math.ceil((yMaxData + yPad) / yStep) * yStep;
            if (yAxisMin >= yMinData - 1e-9) yAxisMin -= yStep;
            if (yAxisMax <= yMaxData + 1e-9) yAxisMax += yStep;

            // Percorso della costruzione ausiliaria (verticale-orizzontale-verticale)
            // che mostra come si ottiene il punto sulla retta AC a partire da AB:
            // sale da x=xAux fino a B (su AB), va in orizzontale fino a x=1.15*xAux
            // (alla stessa quota), poi scende fino all'asse delle ascisse.
            let auxConstructionData = [];
            let auxPointsData = [];
            if (xAux !== null) {
                auxConstructionData = [
                    { x: xAux, y: yAxisMax },
                    { x: xAux, y: yAux },
                    { x: xAuxC, y: yAux },
                    { x: xAuxC, y: yAxisMax }
                ];
                auxPointsData = [{ x: xAux, y: yAux }, { x: xAuxC, y: yAux }];
            }

            const yMinorStep = yStep > 0.1 ? 0.1 : yStep / 2;
            const yTicksConfig = {
                stepSize: yMinorStep,
                maxTicksLimit: Math.ceil((yAxisMax - yAxisMin) / yMinorStep) + 2,
                autoSkip: false,
                callback: function (value) {
                    const ratio = (value - yAxisMin) / yStep;
                    const isMajor = Math.abs(ratio - Math.round(ratio)) < 1e-6;
                    return isMajor ? Math.round(value * 100) / 100 : '';
                }
            };
            const yGridConfig = {
                color: function (context) {
                    const value = context && context.tick ? context.tick.value : null;
                    if (value === null) return 'rgba(160, 174, 192, 0.5)';
                    const ratio = (value - yAxisMin) / yStep;
                    const isMajor = Math.abs(ratio - Math.round(ratio)) < 1e-6;
                    return isMajor ? 'rgba(160, 174, 192, 0.55)' : 'rgba(160, 174, 192, 0.3)';
                }
            };

            if (chart) {
                chart.data.datasets[0].data = curveData;
                chart.data.datasets[1].data = rawData;
                chart.data.datasets[2].data = pointB;
                chart.data.datasets[3].data = lineABData;
                chart.data.datasets[4].data = lineACData;
                chart.data.datasets[5].data = pointD90Data;
                chart.data.datasets[6].data = pointA0;
                chart.data.datasets[7].data = auxConstructionData;
                chart.data.datasets[8].data = auxPointsData;
                chart.options.scales.x.max = xRightEdge;
                chart.options.scales.y.min = yAxisMin;
                chart.options.scales.y.max = yAxisMax;
                chart.options.scales.y.ticks = yTicksConfig;
                chart.options.scales.y.grid = yGridConfig;
                chart.update('none');
                return;
            }

            const ctx = canvas.getContext('2d');
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        { label: 'Deformazione (interpolata)', data: curveData, borderColor: '#1E507F', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0 },
                        { label: 'Punti di prova', data: rawData, borderColor: '#1E507F', backgroundColor: '#ffffff', borderWidth: 2, pointRadius: 4, showLine: false },
                        { label: 'Punto B (fine tratto iniziale)', data: pointB, borderColor: '#4a5568', backgroundColor: '#4a5568', pointRadius: 5, showLine: false },
                        { label: 'Retta AB (tratto iniziale)', data: lineABData, borderColor: '#dd6b20', borderWidth: 2, pointRadius: 0, tension: 0 },
                        { label: 'Retta AC (1.15×AB)', data: lineACData, borderColor: '#805ad5', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0 },
                        { label: 'Punto C (U=90%)', data: pointD90Data, borderColor: '#38a169', backgroundColor: '#38a169', pointRadius: 6, pointStyle: 'star', showLine: false },
                        { label: 'Punto A (U=0%, D₀)', data: pointA0, borderColor: '#e53e3e', backgroundColor: '#e53e3e', pointRadius: 6, showLine: false },
                        { label: 'Costruzione AC (orizzontale ausiliaria, 1.15×)', data: auxConstructionData, borderColor: '#0d9488', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, tension: 0 },
                        { label: 'B e C ausiliari (stessa quota)', data: auxPointsData, borderColor: '#0d9488', backgroundColor: '#0d9488', pointRadius: 4, pointStyle: 'rectRot', showLine: false }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { type: 'linear', min: 0, max: xRightEdge, title: { display: true, text: '√t (√min)' } },
                        y: { type: 'linear', reverse: true, min: yAxisMin, max: yAxisMax, title: { display: true, text: 'Deformazione (mm)' }, ticks: yTicksConfig, grid: yGridConfig }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 10 } } },
                        tooltip: {
                            callbacks: {
                                title: items => `√t = ${parseFloat(items[0].parsed.x.toFixed(2))}`,
                                label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(3)} mm`
                            }
                        }
                    }
                }
            });
        }

        renderTable();
        recompute();
    }

    initEdoSubTabs();
    initSettlementModule();
    initSigmaPTool();
    initCvCasagrandeTool();
    initCvTaylorTool();
}

function initShearModule() {
    const cInput = document.getElementById('mohr-c');
    const phiInput = document.getElementById('mohr-phi');
    const canvas = document.getElementById('mohrChart');
    if (!cInput || !phiInput || !canvas) return;

    const valC = document.getElementById('val-mohr-c');
    const valPhi = document.getElementById('val-mohr-phi');
    const planeAngleOut = document.getElementById('mohr-plane-angle');

    // Colori distintivi per ciascuna prova: usati sia per il bordo del box
    // controlli (vedi CSS .mohr-test[data-test]) sia per il relativo cerchio
    // nel grafico, cosi' e' immediato associare controllo e curva.
    const TEST_COLORS = ['#1E507F', '#38a169', '#d69e2e'];

    const tests = [1, 2, 3].map(n => ({
        n,
        enableInput: document.getElementById(`mohr-enable-${n}`),
        body: document.getElementById(`mohr-body-${n}`),
        s3Input: document.getElementById(`mohr-s3-${n}`),
        s1Input: document.getElementById(`mohr-s1-${n}`),
        valS3: document.getElementById(`val-mohr-s3-${n}`),
        valS1: document.getElementById(`val-mohr-s1-${n}`),
        stateEl: document.getElementById(`mohr-state-${n}`),
        color: TEST_COLORS[n - 1]
    })).filter(t => t.s3Input && t.s1Input);

    let mohrChart = null;
    const ctx = canvas.getContext('2d');

    // Estensione minima (in kPa) che i due assi devono coprire perche' nessun
    // cerchio e nessun tratto dell'inviluppo restino tagliati fuori dal grafico.
    // Viene ricalcolata ad ogni update() e riletta da fixAspect() per sapere di
    // quanto puo' "allargare" un asse senza mai scendere sotto questo minimo.
    let neededX = 200;
    let neededY = 100;

    // Punti del semicerchio di Mohr (solo τ≥0, come nelle diapositive del corso):
    // centro e raggio in kPa, campionati su un angolo da 0 a 180°.
    function circlePoints(center, radius, steps = 60) {
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const theta = Math.PI * (i / steps);
            pts.push({ x: center + radius * Math.cos(theta), y: radius * Math.sin(theta) });
        }
        return pts;
    }

    // I cerchi di Mohr devono apparire come cerchi, non come ellissi: serve che
    // un kPa sull'asse σ' occupi sullo schermo esattamente gli stessi pixel di
    // un kPa sull'asse τ. L'area di disegno del grafico però non è quadrata (la
    // sua larghezza dipende dalla colonna dei controlli e la sua altezza da
    // legenda/etichette), quindi dopo ogni render si misura l'area realmente
    // disegnata (chartArea) e si allarga l'asse più "compresso" in pixel/unità
    // finché i due rapporti non coincidono — senza mai restringere sotto il
    // minimo richiesto da neededX/neededY, cosi' non si taglia mai nulla.
    function fixAspect(chartArg) {
        // Accetta il chart per parametro (passato da 'animation.onComplete',
        // che Chart.js invoca con {chart}) invece di leggere solo la variabile
        // di chiusura 'mohrChart': se il completamento dell'animazione scattasse
        // in modo sincrono durante 'new Chart(...)' (prima che l'assegnazione
        // 'mohrChart = new Chart(...)' sia stata eseguita), la sola variabile di
        // chiusura sarebbe ancora null e la correzione verrebbe saltata.
        const chart = chartArg || mohrChart;
        if (!chart) return;
        const area = chart.chartArea;
        if (!area) return;
        const pxWidth = area.right - area.left;
        const pxHeight = area.bottom - area.top;
        if (!(pxWidth > 0) || !(pxHeight > 0)) return;

        const xMaxNow = chart.scales.x.max;
        const yMaxNow = chart.scales.y.max;
        if (!(xMaxNow > 0) || !(yMaxNow > 0)) return;

        const pxPerUnitX = pxWidth / xMaxNow;
        const pxPerUnitY = pxHeight / yMaxNow;
        const mismatch = Math.abs(pxPerUnitX - pxPerUnitY) / Math.max(pxPerUnitX, pxPerUnitY);
        if (mismatch < 0.01) return; // già circolare: evita un update infinito

        const pxRatio = pxWidth / pxHeight;
        let finalX = neededX;
        let finalY = neededX / pxRatio;
        if (finalY < neededY) {
            finalY = neededY;
            finalX = neededY * pxRatio;
        }

        chart.options.scales.x.max = finalX;
        chart.options.scales.y.max = finalY;
        chart.update('none');
    }

    function update() {
        const c = parseFloat(cInput.value);
        const phiDeg = parseFloat(phiInput.value);
        const phiRad = phiDeg * Math.PI / 180;

        valC.textContent = c.toFixed(0);
        valPhi.textContent = phiDeg.toFixed(1);
        planeAngleOut.textContent = (45 + phiDeg / 2).toFixed(1);

        const active = [];
        let maxSigma1 = 100;
        let maxRadius = 50;

        tests.forEach(t => {
            const isFirst = t.n === 1;
            const isActive = isFirst || (t.enableInput && t.enableInput.checked);
            if (!isFirst && t.body) t.body.hidden = !isActive;

            if (!isActive) {
                if (t.stateEl) {
                    t.stateEl.textContent = '—';
                    t.stateEl.className = 'sif-status sif-status-neutral';
                }
                return;
            }

            // σ'1 non può scendere sotto σ'3: come per gli slider "gamma_sat" del
            // modulo Tensioni, si alza dinamicamente il minimo dello slider e si
            // corregge il valore corrente se necessario, invece di bloccare l'input.
            const s3 = parseFloat(t.s3Input.value);
            t.s1Input.min = s3;
            let s1 = parseFloat(t.s1Input.value);
            if (s1 < s3) {
                s1 = s3;
                t.s1Input.value = s1;
            }

            t.valS3.textContent = s3.toFixed(0);
            t.valS1.textContent = s1.toFixed(0);

            const center = (s1 + s3) / 2;
            const radius = (s1 - s3) / 2;
            maxSigma1 = Math.max(maxSigma1, s1);
            maxRadius = Math.max(maxRadius, radius);

            // Distanza del centro del cerchio dalla retta di inviluppo
            // τ = c' + σ'tanφ' (forma normale: σ'sinφ' - τcosφ' + c'cosφ' = 0).
            const d = center * Math.sin(phiRad) + c * Math.cos(phiRad);
            const diff = radius - d; // >0: il cerchio supera l'inviluppo
            const tol = Math.max(1, radius * 0.01);

            let statusText, statusClass;
            if (diff > tol) {
                statusText = "Non ammissibile: il cerchio supera il criterio di rottura";
                statusClass = 'sif-status-critical';
            } else if (diff > -tol) {
                statusText = "Esattamente a rottura (cerchio tangente all'inviluppo)";
                statusClass = 'sif-status-neutral';
            } else {
                statusText = "In sicurezza: il cerchio resta sotto il criterio di rottura";
                statusClass = 'sif-status-ok';
            }
            if (t.stateEl) {
                t.stateEl.textContent = statusText;
                t.stateEl.className = 'sif-status ' + statusClass;
            }

            active.push({ n: t.n, s3, s1, color: t.color, points: circlePoints(center, radius) });
        });

        // Estensione minima dei due assi (in kPa), calcolata separatamente per
        // σ' e per τ: quanto basta a contenere il cerchio più grande e il
        // tratto di inviluppo visibile, arrotondata per evitare micro-
        // oscillazioni dei tick muovendo gli slider. fixAspect() userà queste
        // come minimi e allargherà l'asse più "compresso" per ottenere cerchi
        // veri (non ellissi), senza mai scendere sotto questi valori.
        const rawX = Math.max(maxSigma1 * 1.15, 200);
        neededX = Math.max(100, Math.ceil(rawX / 50) * 50);
        const rawY = Math.max(maxRadius * 1.15, (c + neededX * Math.tan(phiRad)) * 1.15, 100);
        neededY = Math.max(50, Math.ceil(rawY / 50) * 50);

        const envelope = [{ x: 0, y: c }, { x: neededX, y: c + neededX * Math.tan(phiRad) }];

        // Etichette di legenda volutamente statiche (senza i valori numerici,
        // già mostrati negli slider e nel box di stato di ciascuna prova):
        // se cambiassero ad ogni movimento dello slider, la larghezza della
        // legenda oscillerebbe continuamente, alterando l'altezza dell'area di
        // disegno e quindi la scala calcolata da fixAspect().
        const datasets = active.map(t => ({
            label: `Prova ${t.n}`,
            data: t.points,
            borderColor: t.color,
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0
        }));
        datasets.push({
            label: "Criterio di rottura",
            data: envelope,
            borderColor: '#e53e3e',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0
        });

        if (mohrChart) {
            mohrChart.data.datasets = datasets;
            mohrChart.options.scales.x.max = neededX;
            mohrChart.options.scales.y.max = neededY;
            mohrChart.update('none');
            fixAspect();
        } else {
            mohrChart = new Chart(ctx, {
                type: 'line',
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    // 'onComplete' (non un semplice 'animation:false') è necessario
                    // perché fixAspect() ha bisogno della chartArea REALE dopo il
                    // render: serve anche quando il tab viene sbloccato e il canvas,
                    // fino a quel momento nascosto, viene ridimensionato da Chart.js.
                    animation: {
                        onComplete: (context) => fixAspect(context && context.chart)
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            min: 0,
                            max: neededX,
                            title: { display: true, text: "Tensione normale efficace σ' (kPa)" }
                        },
                        y: {
                            type: 'linear',
                            min: 0,
                            max: neededY,
                            title: { display: true, text: 'Tensione tangenziale τ (kPa)' }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { boxWidth: 16, padding: 12, font: { size: 11 } }
                        },
                        tooltip: { enabled: false }
                    }
                }
            });
        }
    }

    tests.forEach(t => {
        if (t.enableInput) t.enableInput.addEventListener('change', update);
        t.s3Input.addEventListener('input', update);
        t.s1Input.addEventListener('input', update);
    });
    [cInput, phiInput].forEach(input => input.addEventListener('input', update));

    update();
}

