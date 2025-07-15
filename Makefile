.PHONY: all venv clean images
.SUFFIXES: .bs .html

IMAGES := $(wildcard images/*.svg)

all: build/index.html

clean:
	-rm -rf build venv

venv-marker := venv/.make
bikeshed := venv/bin/bikeshed
venv: $(venv-marker)

$(venv-marker): Makefile
	python3.12 -m venv venv
	@touch $@

$(bikeshed): $(venv-marker) Makefile
	venv/bin/pip install $(notdir $@)
	@touch $@

build:
	mkdir -p $@

build/index.html: api.bs $(IMAGES) build $(bikeshed)
	$(bikeshed) --die-on=warning spec $< $@

images:
	@echo "Regenerating images"
	for i in $(IMAGES); do \
	  tmp="$$(mktemp)"; \
	  npx aasvg --extract --embed <"$$i" >"$$tmp" && mv "$$tmp" "$$i"; \
	done
