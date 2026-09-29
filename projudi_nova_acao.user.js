// ==UserScript==
// @name         Projudi - Cadastrar Nova Ação
// @namespace    https://projudi2.tjpr.jus.br/
// @version      0.1
// @description  Passo 1: abre o menu Processos e clica em "Cadastrar Nova Ação"
// @match        https://projudi2.tjpr.jus.br/projudi/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Aguarda fn() devolver algo truthy (o menu SmartMenus e as páginas carregam de forma assíncrona).
    async function esperar(fn, timeout = 5000) {
        const fim = Date.now() + timeout;
        while (Date.now() < fim) {
            const r = fn();
            if (r) return r;
            await sleep(100);
        }
        return null;
    }

    // O id do menu (sm-<número>-1) muda a cada carregamento: usa name + texto.
    function botaoProcessos() {
        return [...document.querySelectorAll('a[name="projudiMenu"]')]
            .find(a => norm(a.firstChild && a.firstChild.textContent) === 'processos') || null;
    }

    function itemNovaAcao(botao) {
        const sub = document.getElementById(botao.getAttribute('aria-controls'));
        if (!sub) return null;
        return [...sub.querySelectorAll('a')]
            .find(a => norm(a.textContent) === 'cadastrar nova ação') || null;
    }

    async function cadastrarNovaAcao() {
        const botao = botaoProcessos();
        if (!botao) return console.warn('[NovaAção] menu "Processos" não encontrado nesta frame');

        // Clique real (o JS do Projudi/SmartMenus ignora eventos sintéticos).
        if (botao.getAttribute('aria-expanded') !== 'true') botao.click();

        const item = await esperar(() => {
            const a = itemNovaAcao(botao);
            return a && a.offsetParent !== null ? a : null; // só quando o submenu estiver visível
        });
        if (!item) return console.warn('[NovaAção] item "Cadastrar Nova Ação" não apareceu');

        console.log('[NovaAção] clicando em', item.href || item.outerHTML);
        item.click();
    }

    // Só age quando o usuário pede, e apenas na frame que contém o menu.
    if (botaoProcessos()) {
        const btn = document.createElement('button');
        btn.textContent = '➕ Nova Ação';
        btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;padding:8px 12px;cursor:pointer';
        btn.onclick = cadastrarNovaAcao;
        document.body.appendChild(btn);
    }
})();
