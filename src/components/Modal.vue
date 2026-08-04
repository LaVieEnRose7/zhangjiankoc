<template>
  <n-modal
    :show="show"
    :auto-focus="false"
    :mask-closable="true"
    @mask-click="$emit('close')"
    @esc="$emit('close')"
  >
    <n-card
      :class="['modal', 'naive-modal-card', { wide }]"
      :style="{ width: wide ? '820px' : '560px', maxWidth: 'calc(100vw - 32px)' }"
      :bordered="false"
      closable
      role="dialog"
      @close="$emit('close')"
    >
      <template #header>
        <slot name="head"></slot>
      </template>
      <div class="modal-body">
        <slot></slot>
      </div>
      <template #footer v-if="$slots.foot">
        <slot name="foot"></slot>
      </template>
    </n-card>
  </n-modal>
</template>

<script setup>
defineProps({
  show: Boolean,
  wide: Boolean
})
defineEmits(['close'])
</script>
