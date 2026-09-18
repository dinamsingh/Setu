"""Unit Tests for Domain Alias Expander."""

import pytest
from engine.alias_expander import DomainAliasExpander


@pytest.fixture
def expander():
    return DomainAliasExpander()


def test_alias_expansion_single_term(expander):
    text = "Spool erection finished at Section 2"
    expanded, aliases, disciplines = expander.expand(text)
    
    assert len(aliases) >= 1
    assert any(a["field_term"] == "spool" for a in aliases)
    assert "Piping" in disciplines
    assert "prefabricated piping spool erection" in expanded.lower()


def test_alias_expansion_multiple_terms(expander):
    text = "Carried out hydrotest on line after golden tie-in joint welded"
    expanded, aliases, disciplines = expander.expand(text)
    
    terms = [a["field_term"] for a in aliases]
    assert "hydrotest" in terms
    assert "tie-in" in terms
    assert "Piping" in disciplines


def test_alias_expansion_no_jargon(expander):
    text = "Regular project team coordination meeting was held in afternoon"
    expanded, aliases, disciplines = expander.expand(text)
    
    assert len(aliases) == 0
    assert len(disciplines) == 0
    assert expanded == text


def test_alias_expansion_empty_string(expander):
    expanded, aliases, disciplines = expander.expand("")
    assert expanded == ""
    assert aliases == []
    assert len(disciplines) == 0
