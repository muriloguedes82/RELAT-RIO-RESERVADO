// ==UserScript==
// @name         Projudi - Cadastrar Nova Ação
// @namespace    https://projudi2.tjpr.jus.br/
// @version      0.3
// @description  Abre Processos > Cadastrar Nova Ação e avança as etapas do cadastro
// @match        https://projudi2.tjpr.jus.br/projudi/*
// @grant        none
// ==/UserScript==

// Estrutura do Projudi: frameset (topFrame + mainFrame). O menu fica em mainFrame e o
// formulário de cadastro abre no iframe "userMainFrame" dentro dele. O script roda em
// todas as frames; a frame do menu inicia o fluxo e a frame do formulário executa as
// etapas. Como cada "Próximo Passo" recarrega a página, o estado fica em sessionStorage
// (compartilhado entre frames da mesma origem na mesma aba).

(function () {
    'use strict';

    const CLASSE_PROCESSUAL = '1307';
    const CHAVE_ATIVO = 'novaAcao_ativo';
    const log = (...a) => console.log('[NovaAção]', ...a);

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Aguarda fn() devolver algo truthy (menu, página e autocomplete carregam de forma assíncrona).
    async function esperar(fn, timeout = 5000) {
        const fim = Date.now() + timeout;
        while (Date.now() < fim) {
            const r = fn();
            if (r) return r;
            await sleep(100);
        }
        return null;
    }

    // ── Menu (frame mainFrame) ──────────────────────────────────────────────────────

    // O id do menu (sm-<número>-1) muda a cada carregamento: usa name + classe + texto.
    function botaoProcessos() {
        return [...document.querySelectorAll('a[name="projudiMenu"].has-submenu')]
            .find(a => norm(a.firstChild && a.firstChild.textContent) === 'processos') || null;
    }

    function itemNovaAcao() {
        return [...document.querySelectorAll('a[name="projudiMenu"]')]
            .find(a => norm(a.textContent) === 'cadastrar nova ação') || null;
    }

    async function iniciar() {
        const botao = botaoProcessos();
        if (!botao) return log('menu "Processos" não encontrado');

        // Clique real (o JS do Projudi/SmartMenus ignora eventos sintéticos).
        if (botao.getAttribute('aria-expanded') !== 'true') botao.click();

        // Espera o submenu ficar visível; se não abrir, clica no item assim mesmo (ele tem
        // href real com target="userMainFrame").
        await esperar(() => { const a = itemNovaAcao(); return a && a.offsetParent !== null; }, 2000);
        const item = itemNovaAcao();
        if (!item) return log('item "Cadastrar Nova Ação" não encontrado');

        sessionStorage.setItem(CHAVE_ATIVO, '1');
        log('clicando em Cadastrar Nova Ação');
        item.click();
    }

    // ── Etapas do cadastro (iframe userMainFrame) ───────────────────────────────────

    // Cada etapa é identificada pelo indicador lateral <span class="currentStep">N - Título</span>.
    function etapaAtual() {
        const span = document.querySelector('span.currentStep');
        const n = span && parseInt(span.textContent, 10);
        return Number.isFinite(n) ? n : 0;
    }

    // Na etapa 1, Localidade (codComarca) e Competência (codAreaDeVaras) são carregadas por
    // AJAX em cascata a partir do Tribunal; avançar antes disso envia o formulário incompleto.
    function combosEtapa1Prontos() {
        return ['codComarca', 'codAreaDeVaras'].every(id => {
            const sel = document.getElementById(id);
            return sel && sel.options.length > 0 && sel.value && sel.value !== '0';
        });
    }

    function proximoPasso() {
        const btn = document.getElementById('nextButton');
        if (!btn) return log('botão "Próximo Passo" não encontrado');
        log('clicando em Próximo Passo');
        btn.click(); // executa o onclick (troca o action do form) e submete
    }

    // Autocomplete do Projudi (Prototype/script.aculo.us): reage a keydown no campo e
    // desenha as sugestões como <li> dentro de div#ajaxAuto_<id>.
    async function preencherAutocomplete(id, texto) {
        const input = document.getElementById(id);
        if (!input) return log('campo', id, 'não encontrado');

        input.focus();
        input.value = texto;
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: texto.slice(-1) }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: texto.slice(-1) }));
        input.dispatchEvent(new Event('input', { bubbles: true }));

        const li = await esperar(() => {
            const div = document.getElementById('ajaxAuto_' + id);
            if (!div || div.style.display === 'none') return null;
            return [...div.querySelectorAll('li')].find(l => norm(l.textContent).startsWith(texto)) || null;
        }, 10000);
        if (!li) return log('sugestão', texto, 'não apareceu em', id);

        log('selecionando', li.textContent.trim());
        li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        li.click();
        return true;
    }

    async function executarEtapa() {
        const etapa = await esperar(etapaAtual, 5000);
        log('etapa', etapa);
        if (etapa === 1) {
            if (!await esperar(combosEtapa1Prontos, 10000)) {
                return log('Localidade/Competência não foram preenchidas automaticamente; selecione e clique em Próximo Passo');
            }
            return proximoPasso();
        }
        if (etapa === 2) return proximoPasso();
        if (etapa === 3) {
            await preencherAutocomplete('descricaoClasseProcessual', CLASSE_PROCESSUAL);
            // Fim do fluxo definido até aqui; as próximas etapas ainda não foram mapeadas.
            sessionStorage.removeItem(CHAVE_ATIVO);
        }
    }

    // ── Ponto de entrada ────────────────────────────────────────────────────────────

    if (document.getElementById('autuacaoProcessoForm')) {
        if (sessionStorage.getItem(CHAVE_ATIVO)) executarEtapa();
    } else if (botaoProcessos()) {
        const btn = document.createElement('button');
        btn.textContent = '➕ Nova Ação';
        btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;padding:8px 12px;cursor:pointer';
        btn.onclick = iniciar;
        document.body.appendChild(btn);
    }
})();
