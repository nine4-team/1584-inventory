import { useState, useEffect } from 'react'
import { Transaction, ProjectBudgetCategories } from '@/types'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCategories } from '@/components/CategorySelect'
import { useAccount } from '@/contexts/AccountContext'

interface BudgetProgressProps {
  budget?: number
  designFee?: number
  budgetCategories?: ProjectBudgetCategories
  transactions: Transaction[]
  previewMode?: boolean // If true, only show primary budget (furnishings or overall) without toggle
}

interface CategoryBudgetData {
  categoryId: string
  categoryName: string
  budget: number
  spent: number
  percentage: number
  isDesignFee: boolean
}


export default function BudgetProgress({ budget, designFee, budgetCategories, transactions, previewMode = false }: BudgetProgressProps) {
  const { currentAccountId } = useAccount()
  const { categories: accountCategories, isLoading: categoriesLoading } = useCategories(false)
  const [showAllCategories, setShowAllCategories] = useState(false)

  // Create a map of categoryId -> category name for quick lookup
  const categoryMap = new Map<string, string>()
  accountCategories.forEach(cat => {
    categoryMap.set(cat.id, cat.name)
  })
  const furnishingsCategoryId = accountCategories.find(cat =>
    cat.name.toLowerCase().includes('furnish')
  )?.id

  // Helper to check if a category is "Design Fee" by name (for backward compatibility)
  const isDesignFeeCategory = (categoryName: string): boolean => {
    return categoryName.toLowerCase().includes('design') && categoryName.toLowerCase().includes('fee')
  }

  const isCanonicalSaleTransaction = (transaction: Transaction): boolean => {
    return transaction.transactionId?.startsWith('INV_SALE_') ?? false
  }

  const getResolvedCategoryId = (transaction: Transaction): string | undefined => {
    if (transaction.categoryId) return transaction.categoryId
    if (!transaction.budgetCategory || !furnishingsCategoryId) return undefined
    if (transaction.budgetCategory.toLowerCase().includes('furnish')) {
      return furnishingsCategoryId
    }
    return undefined
  }

  // Calculate total spent for overall budget (exclude Design Fee transactions)
  const calculateSpent = (): number => {
    // Sum all transactions (purchases add, returns subtract), excluding canceled and design fee transactions
    let totalAmount = 0

    const activeTransactions = transactions.filter(t => {
      if ((t.status || '').toLowerCase() === 'canceled') return false
      const resolvedCategoryId = getResolvedCategoryId(t)
      if (!resolvedCategoryId) return true // Include uncategorized transactions in overall
      const categoryName = categoryMap.get(resolvedCategoryId)
      return categoryName && !isDesignFeeCategory(categoryName)
    })

    for (const transaction of activeTransactions) {
      const transactionAmount = parseFloat(transaction.amount || '0')
      const multiplier = transaction.transactionType === 'Return' || isCanonicalSaleTransaction(transaction) ? -1 : 1
      const finalAmount = transactionAmount * multiplier
      totalAmount += finalAmount
    }

    return totalAmount
  }

  // Calculate spending for each budget category using categoryId
  const calculateCategoryBudgetData = (): CategoryBudgetData[] => {
    const categoryData: CategoryBudgetData[] = []

    // Group transactions by categoryId
    const transactionsByCategoryId = new Map<string, Transaction[]>()
    transactions.forEach(transaction => {
      if ((transaction.status || '').toLowerCase() === 'canceled') return
      const resolvedCategoryId = getResolvedCategoryId(transaction)
      if (!resolvedCategoryId) return // Skip uncategorized transactions for category breakdown

      if (!transactionsByCategoryId.has(resolvedCategoryId)) {
        transactionsByCategoryId.set(resolvedCategoryId, [])
      }
      transactionsByCategoryId.get(resolvedCategoryId)!.push(transaction)
    })

    // Process each category that has transactions or a budget set
    transactionsByCategoryId.forEach((categoryTransactions, categoryId) => {
      const categoryName = categoryMap.get(categoryId)
      if (!categoryName) return // Skip if category not found

      const isDesignFee = isDesignFeeCategory(categoryName)
      
      // Calculate spent for this category
      let categorySpent = 0
      for (const transaction of categoryTransactions) {
        const transactionAmount = parseFloat(transaction.amount || '0')
        const multiplier = transaction.transactionType === 'Return' || isCanonicalSaleTransaction(transaction) ? -1 : 1
        const finalAmount = transactionAmount * multiplier
        categorySpent += finalAmount
      }

      // Determine budget for this category
      let categoryBudget = 0
      if (isDesignFee) {
        // Use designFee prop for design fee category
        categoryBudget = designFee || 0
      } else {
        // Use categoryId to look up budget from budgetCategories (new format: Record<categoryId, amount>)
        if (budgetCategories && categoryId) {
          categoryBudget = budgetCategories[categoryId] || 0
        }
      }

      // Show category if it has a budget set or has transactions
      const shouldShowCategory = categoryBudget > 0 || categorySpent !== 0

      if (shouldShowCategory) {
        const percentage = categoryBudget > 0 ? (categorySpent / categoryBudget) * 100 : 0

        categoryData.push({
          categoryId,
          categoryName,
          budget: categoryBudget,
          spent: Math.round(categorySpent),
          percentage: Math.min(percentage, 100), // Cap at 100%
          isDesignFee
        })
      }
    })

    // Also include categories from budgetCategories that might not have transactions yet
    // budgetCategories is now Record<categoryId, amount>
    if (budgetCategories) {
      Object.entries(budgetCategories).forEach(([categoryId, budgetAmount]) => {
        // Skip if already processed (has transactions)
        const alreadyPresent = categoryData.find(cat => cat.categoryId === categoryId)
        if (alreadyPresent || budgetAmount <= 0) return

        // Find the category name from account categories
        const accountCat = accountCategories.find(cat => cat.id === categoryId)
        if (accountCat) {
          const isDesignFee = isDesignFeeCategory(accountCat.name)
          categoryData.push({
            categoryId: accountCat.id,
            categoryName: accountCat.name,
            budget: budgetAmount,
            spent: 0,
            percentage: 0,
            isDesignFee
          })
        }
      })
    }

    // Sort: Design Fee last, then by name
    categoryData.sort((a, b) => {
      if (a.isDesignFee && !b.isDesignFee) return 1
      if (!a.isDesignFee && b.isDesignFee) return -1
      return a.categoryName.localeCompare(b.categoryName)
    })

    return categoryData
  }

  const [spent, setSpent] = useState(0)
  const [percentage, setPercentage] = useState(0)
  const [allCategoryData, setAllCategoryData] = useState<CategoryBudgetData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [computedOverallBudget, setComputedOverallBudget] = useState<number>(budget || 0)

  // Calculate budget data when component mounts or when props change
  useEffect(() => {
    // Wait for categories to load
    if (categoriesLoading || !currentAccountId) {
      return
    }

    const calculateBudgetData = () => {
      setIsLoading(true)

      try {
        const spentAmount = calculateSpent()
        const categoryData = calculateCategoryBudgetData()

        // Compute overall budget as the sum of category budgets (exclude design fee)
        const overallFromCategories = categoryData
          .filter(cat => !cat.isDesignFee)
          .reduce((sum, cat) => sum + cat.budget, 0)

        const spentRounded = Math.round(spentAmount)
        const percentageValue = overallFromCategories > 0 ? (spentRounded / overallFromCategories) * 100 : 0

        setSpent(spentRounded)
        setPercentage(percentageValue)
        setAllCategoryData(categoryData)
        setComputedOverallBudget(overallFromCategories)
      } catch (error) {
        console.error('Error calculating budget data:', error)
        setSpent(0)
        setPercentage(0)
        setAllCategoryData([])
      } finally {
        setIsLoading(false)
      }
    }

    calculateBudgetData()
  }, [budget, designFee, budgetCategories, transactions, accountCategories, categoriesLoading, currentAccountId])

  // In preview mode, determine what to show: furnishings budget if it exists, otherwise overall furnishings-only budget
  let categoryData = allCategoryData
  let overallBudgetCategory: CategoryBudgetData | null = null

  if (previewMode) {
    // In preview mode, show only the primary budget (furnishings if set, otherwise overall)
    const furnishingsCategory = allCategoryData.find(cat => 
      cat.categoryName.toLowerCase().includes('furnish')
    )
    if (furnishingsCategory) {
      // Show only furnishings budget category
      categoryData = [furnishingsCategory]
    } else if (computedOverallBudget > 0) {
      // No category budgets set, show overall budget (sum of categories, excluding design fee)
      overallBudgetCategory = {
        categoryId: 'overall',
        categoryName: 'Overall Budget',
        budget: computedOverallBudget,
        spent: spent,
        percentage: percentage,
        isDesignFee: false
      }
    }
  } else {
    // Full mode: Filter categories based on toggle state - show only furnishings by default, others when expanded
    const furnishingsCategory = allCategoryData.find(cat => 
      cat.categoryName.toLowerCase().includes('furnish')
    )
    
    if (showAllCategories) {
      categoryData = allCategoryData
    } else {
      // Show only furnishings if it exists
      categoryData = furnishingsCategory ? [furnishingsCategory] : []
    }

    // Add overall budget as a category if it exists and should be shown
    // Show overall budget only when the toggle is expanded (showAllCategories === true)
    const shouldShowOverallBudget = computedOverallBudget > 0 && showAllCategories

    overallBudgetCategory = shouldShowOverallBudget ? {
      categoryId: 'overall',
      categoryName: 'Overall Budget',
      budget: computedOverallBudget,
      spent: spent,
      percentage: percentage,
      isDesignFee: false
    } : null
  }

  // Build the final render list and append overall budget at the very bottom (below Design Fee)
  const renderCategories: CategoryBudgetData[] = (() => {
    const cats: CategoryBudgetData[] = [...(categoryData || [])]
    if (overallBudgetCategory) {
      // Always append overall budget at the end of the list
      cats.push(overallBudgetCategory)
    }
    return cats
  })()


  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-red-500'
    if (percentage >= 75) return 'bg-red-500' // 75%+ spent = bad (red)
    if (percentage >= 50) return 'bg-yellow-500' // 50-74% spent = warning (yellow)
    return 'bg-green-500' // Less than 50% spent = good (green)
  }

  // Color logic for remaining amounts (green when plenty left, yellow when warning, red when over)
  const getRemainingColor = (percentage: number) => {
    if (percentage >= 100) return 'text-red-600' // Over budget = red
    if (percentage >= 75) return 'text-red-600' // 75%+ spent = bad (red)
    if (percentage >= 50) return 'text-yellow-600' // 50-74% spent = warning (yellow)
    return 'text-green-600' // Less than 50% spent = good (green)
  }

  // Reversed color logic for design fee (green when received, red when not received)
  const getDesignFeeProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-green-500' // Fully received = good (green)
    if (percentage >= 75) return 'bg-green-500' // 75%+ received = good (green)
    if (percentage >= 50) return 'bg-yellow-500' // 50%+ received = warning (yellow)
    return 'bg-red-500' // Less than 50% received = bad (red)
  }

  // Reversed color logic for design fee remaining amounts
  const getDesignFeeRemainingColor = (percentage: number) => {
    if (percentage >= 100) return 'text-green-600' // Fully received = good (green)
    if (percentage >= 75) return 'text-green-600' // 75%+ received = good (green)
    if (percentage >= 50) return 'text-yellow-600' // 50%+ received = warning (yellow)
    return 'text-red-600' // Less than 50% received = bad (red)
  }

  // Format category names to include "Budget" suffix
  const formatCategoryName = (categoryName: string) => {
    // Don't add "Budget" to Design Fee or Overall Budget as they're already clear
    if (categoryName.toLowerCase().includes('design') && categoryName.toLowerCase().includes('fee')) {
      return categoryName
    }
    if (categoryName === 'Overall Budget') {
      return categoryName
    }
    return `${categoryName} Budget`
  }

  // If no budget or categories are set, don't show anything
  const hasOverallBudget = computedOverallBudget > 0
  const hasDesignFee = designFee !== null && designFee !== undefined && designFee > 0
  const hasCategoryBudgets = budgetCategories && Object.values(budgetCategories).some(v => v > 0)

  // Show loading state while calculating
  if (isLoading) {
    return (
      <div>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-2 bg-gray-200 rounded mb-4"></div>
        </div>
      </div>
    )
  }

  if (!hasOverallBudget && !hasDesignFee && !hasCategoryBudgets) {
    return null
  }

  // In preview mode, use same format as full mode but without toggle and only showing primary budget
  if (previewMode) {
    return (
      <div>
        {/* Category Budget Progress */}
        {(categoryData.length > 0 || overallBudgetCategory) && (
          <div>

            <div className="space-y-4">
              {[...categoryData, ...(overallBudgetCategory ? [overallBudgetCategory] : [])].map((category) => {
                return (
                  <div key={category.categoryId}>
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-base font-medium text-gray-900">{formatCategoryName(category.categoryName)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">
                          ${Math.round(category.spent).toLocaleString('en-US')} {category.isDesignFee ? 'received' : 'spent'}
                        </span>
                      <span className={`text-sm ${category.isDesignFee ? getDesignFeeRemainingColor(category.percentage) : getRemainingColor(category.percentage)}`}>
                        {(() => {
                          const remainingAmount = Math.round((category.budget || 0) - category.spent)
                          if (category.isDesignFee || remainingAmount >= 0) {
                            return (
                              <>
                                <span className="font-bold">${remainingAmount.toLocaleString('en-US')}</span> remaining
                              </>
                            )
                          }
                          return (
                            <>
                              <span className="font-bold">${Math.abs(remainingAmount).toLocaleString('en-US')}</span> over
                            </>
                          )
                        })()}
                      </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="relative">
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-1 relative">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            category.isDesignFee ? getDesignFeeProgressColor(category.percentage) : getProgressColor(category.percentage)
                          }`}
                          style={{ width: `${Math.min(category.percentage, 100)}%` }}
                        />
                        {!category.isDesignFee && category.spent > (category.budget || 0) && category.budget > 0 && (
                          <div
                            className="absolute top-0 right-0 h-2 rounded-full bg-red-800"
                            style={{
                              width: `${Math.min(((category.spent - category.budget) / category.budget) * 100, 100)}%`
                            }}
                          />
                        )}
                      </div>

                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        )}

        {/* Show message if no budgets are configured */}
        {!budget && !designFee && (!budgetCategories || Object.values(budgetCategories).every(v => v === 0)) && (
          <div className="text-center py-4 text-gray-500">
            <p>No budgets configured for this project.</p>
          </div>
        )}
      </div>
    )
  }

  // Full mode with toggle functionality
  return (
    <div>
      {/* Category Budget Progress */}
      {(categoryData.length > 0 || overallBudgetCategory) && (
        <div>

          <div className="space-y-4">
            {renderCategories.map((category) => {
              return (
                <div key={category.categoryId}>
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-base font-medium text-gray-900">{formatCategoryName(category.categoryName)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">
                        ${Math.round(category.spent).toLocaleString('en-US')} {category.isDesignFee ? 'received' : 'spent'}
                      </span>
                      <span className={`text-sm ${category.isDesignFee ? getDesignFeeRemainingColor(category.percentage) : getRemainingColor(category.percentage)}`}>
                        {(() => {
                          const remainingAmount = Math.round((category.budget || 0) - category.spent)
                          if (category.isDesignFee || remainingAmount >= 0) {
                            return (
                              <>
                                <span className="font-bold">${remainingAmount.toLocaleString('en-US')}</span> remaining
                              </>
                            )
                          }
                          return (
                            <>
                              <span className="font-bold">${Math.abs(remainingAmount).toLocaleString('en-US')}</span> over
                            </>
                          )
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative">
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-1 relative">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          category.isDesignFee ? getDesignFeeProgressColor(category.percentage) : getProgressColor(category.percentage)
                        }`}
                        style={{ width: `${Math.min(category.percentage, 100)}%` }}
                      />
                      {!category.isDesignFee && category.spent > (category.budget || 0) && category.budget > 0 && (
                        <div
                          className="absolute top-0 right-0 h-2 rounded-full bg-red-800"
                          style={{
                            width: `${Math.min(((category.spent - category.budget) / category.budget) * 100, 100)}%`
                          }}
                        />
                      )}
                    </div>

                  </div>
                </div>
              )
            })}
          </div>

          {/* Show All Categories Toggle - positioned at bottom */}
          {(allCategoryData.some(cat => {
            const nameLower = cat.categoryName.toLowerCase()
            return !nameLower.includes('furnish') && !cat.isDesignFee
          }) || (budget !== null && budget !== undefined && budget > 0)) && (
            <div className="mt-4">
              <button
                onClick={() => setShowAllCategories(!showAllCategories)}
                className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {showAllCategories ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Show All Budget Categories
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Show message if no budgets are configured */}
      {!budget && !designFee && (!budgetCategories || Object.values(budgetCategories).every(v => v === 0)) && (
        <div className="text-center py-4 text-gray-500">
          <p>No budgets configured for this project.</p>
        </div>
      )}
    </div>
  )
}

