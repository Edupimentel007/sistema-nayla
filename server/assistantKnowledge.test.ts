import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { specialtyValues } from './catalog.js';
import { assistantKnowledgeCoverage, assistantKnowledgeFor } from './assistantKnowledge.js';

describe('Nayla knowledge base', () => {
  it('covers every service specialty in the catalog', () => {
    const coverage = assistantKnowledgeCoverage();
    assert.deepEqual(new Set(coverage.specialties), new Set(specialtyValues));
    assert.equal(coverage.specialties.length, new Set(coverage.specialties).size);
    assert.ok(coverage.appTopics.includes('financeiro'));
    assert.ok(coverage.appTopics.includes('agendamento_cliente'));
  });

  it('prioritizes registered areas for a general business question', () => {
    const context = assistantKnowledgeFor('Como posso atender melhor no meu negócio?', ['cilios', 'unhas']);
    assert.deepEqual(context.registeredAreas, ['Unhas', 'Cílios']);
    assert.deepEqual(context.specialtyGuides.map(item => item.area), ['unhas', 'cilios']);
    assert.ok(context.specialtyGuides.every(item => item.registered));
    assert.ok(context.specialtyGuides.every(item => item.workflow && item.commercialAdvice && item.metrics));
  });

  it('identifies advice about an area outside the professional profile', () => {
    const context = assistantKnowledgeFor('Como organizar maquiagem de noiva?', ['unhas']);
    assert.equal(context.specialtyGuides[0].area, 'maquiagem');
    assert.equal(context.specialtyGuides[0].registered, false);
    assert.deepEqual(context.registeredAreas, ['Unhas']);
  });

  it('provides relevant product instructions with paths and important limits', () => {
    const financial = assistantKnowledgeFor('Como registro uma entrada no financeiro?', ['unhas']);
    assert.ok(financial.appGuides.some(item => item.id === 'financeiro' && item.path === '/app/financeiro'));
    assert.ok(financial.appGuides.find(item => item.id === 'financeiro')?.caveat?.includes('Evite lançar manualmente'));

    const whatsapp = assistantKnowledgeFor('Como configurar WhatsApp e responder urgente?', ['cilios']);
    assert.ok(whatsapp.appGuides.some(item => item.id === 'whatsapp'));
    assert.ok(whatsapp.appGuides.find(item => item.id === 'whatsapp')?.caveat?.includes('não aplica etiqueta nativa'));

    const booking = assistantKnowledgeFor('Como funciona a página de agendamento da cliente?', ['unhas']);
    assert.equal(booking.appGuides[0].id, 'agendamento_cliente');
  });

  it('keeps context bounded for short conversations', () => {
    const context = assistantKnowledgeFor('Me ajude com o app', specialtyValues);
    assert.ok(context.specialtyGuides.length <= 3);
    assert.ok(context.appGuides.length <= 3);
    assert.ok(context.boundaries.some(item => item.includes('exclusivamente de dados atuais')));
  });
});
