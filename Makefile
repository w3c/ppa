.PHONY: all venv clean
.SUFFIXES: .bs .html

all: build/index.html

clean:
	-rm -rf build venv

venv-marker := venv/.make
bikeshed := venv/bin/bikeshed
venv: $(venv-marker)

$(venv-marker): Makefile
	python3 -m venv venv
	@touch $@

$(bikeshed): $(venv-marker) Makefile
	venv/bin/pip install $(notdir $@)
	@touch $@

build:
	mkdir -p $@

build/index.html: api.bs build $(bikeshed)
	$(bikeshed) --die-on=warning spec $< $@
